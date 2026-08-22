// Project team roster. project_members is the single source for avatar
// stacks: the Projektleiter (projects.owner_user_id) is ALSO written here
// with role 'leiter' when a project is created (spec §4.4).

import { db } from "@/db";
import { projectMembers, projects, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { normalizeProjectMemberRole, type ProjectMemberRole } from "@/lib/project-constants";
import { notifyProjectEvent, recordProjectEvent } from "./activity-events";

/**
 * The avatar-stack shape. Defined HERE, not in projects.ts: it is this
 * module's own return type and projects.ts only embeds it. Importing it from
 * "./projects" would make this file reference a module that Task 8 has not
 * created yet — TS2307 at this commit and the four after it, which `vitest`
 * cannot see because a type-only import is erased at runtime.
 */
export interface ProjectMemberData {
  userId: string;
  role: ProjectMemberRole;
  name: string;
  email: string;
  image: string | null;
}

/** Pure: joined user row → the shape every avatar stack renders. */
export function toProjectMemberData(row: {
  userId: string;
  role: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
}): ProjectMemberData {
  return {
    userId: row.userId,
    role: normalizeProjectMemberRole(row.role) ?? "mitglied",
    name: row.name?.trim() || row.email || "Unbekannt",
    email: row.email ?? "",
    image: row.image ?? null,
  };
}

export interface OwnerMembershipInput {
  userId: string;
  role: ProjectMemberRole;
  /**
   * True when the person has at least one task assigned in this project.
   * There is no provenance column on project_members, so this is the
   * evidence for "were they on the team for more than the owner title".
   */
  hasProjectWork: boolean;
}

export interface OwnerMembershipPlan {
  demoteToMitglied: string[];
  remove: string[];
  upsertLeiter: string | null;
}

/**
 * Pure: keep exactly one 'leiter' row when projects.owner_user_id changes.
 *
 *   - the incoming owner is never demoted or removed;
 *   - the outgoing owner is REMOVED when they have no work in the project
 *     (they were only there as the Projektleiter), else DEMOTED to 'mitglied';
 *   - any other stray 'leiter' row is demoted, never deleted — somebody
 *     created it deliberately.
 *
 * JUDGEMENT CALL, not derived from the spec: the index says the previous
 * owner "drops to 'mitglied', or is removed entirely if they were only
 * present as owner", but project_members has no provenance column, so there
 * is no stored fact that answers "only present as owner". `hasProjectWork`
 * (does this person have any task assigned in the project?) is the evidence
 * we chose for it. If that ever proves wrong, add a provenance column rather
 * than bending this helper.
 */
export function resolveOwnerMembership(
  currentMembers: OwnerMembershipInput[],
  oldOwnerId: string | null,
  newOwnerId: string | null,
): OwnerMembershipPlan {
  const demoteToMitglied: string[] = [];
  const remove: string[] = [];

  for (const m of currentMembers) {
    if (m.role !== "leiter") continue;
    if (newOwnerId && m.userId === newOwnerId) continue;
    if (m.userId === oldOwnerId && !m.hasProjectWork) remove.push(m.userId);
    else demoteToMitglied.push(m.userId);
  }

  return { demoteToMitglied, remove, upsertLeiter: newOwnerId };
}

async function loadProject(workspaceId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function listProjectMembers(
  workspaceId: string,
  projectId: string,
): Promise<ProjectMemberData[]> {
  const rows = await db
    .select({
      userId: projectMembers.userId,
      role: projectMembers.role,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.projectId, projectId),
      ),
    )
    .orderBy(projectMembers.createdAt);
  return rows.map(toProjectMemberData);
}

export async function addProjectMember(
  workspaceId: string,
  projectId: string,
  /** Who is doing this — the actor of the activity row. */
  userId: string,
  /** Who is being added — the subject. */
  memberUserId: string,
  role?: string | null,
): Promise<ProjectMemberData | null> {
  const project = await loadProject(workspaceId, projectId);
  if (!project) return null;

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, image: users.image })
    .from(users)
    .where(eq(users.id, memberUserId))
    .limit(1);
  if (!user) return null;

  const resolvedRole = normalizeProjectMemberRole(role) ?? "mitglied";

  const [existing] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, memberUserId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(projectMembers)
      .set({ role: resolvedRole })
      .where(eq(projectMembers.id, existing.id));
  } else {
    await db.insert(projectMembers).values({
      workspaceId,
      projectId,
      userId: memberUserId,
      role: resolvedRole,
    });
    const memberName = user.name?.trim() || user.email || "Unbekannt";
    await notifyProjectEvent({
      workspaceId,
      projectId,
      projectName: project.name,
      eventType: "project.member_added",
      // The ACTOR, not the subject. Attributing the row to the person who was
      // added made the Aktivitäten tab read "Nuri hat Nuri hinzugefügt".
      actorId: userId,
      title: "Neues Projektmitglied",
      body: `${memberName} ist jetzt im Projekt "${project.name}".`,
      payload: { memberUserId, role: resolvedRole },
    });
  }

  return toProjectMemberData({
    userId: memberUserId,
    role: resolvedRole,
    name: user.name,
    email: user.email,
    image: user.image,
  });
}

export async function updateProjectMemberRole(
  workspaceId: string,
  projectId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  /** Whose role is changing — the subject. */
  memberUserId: string,
  role: string,
): Promise<ProjectMemberData | null> {
  const resolvedRole = normalizeProjectMemberRole(role);
  if (!resolvedRole) return null;

  const project = await loadProject(workspaceId, projectId);
  if (!project) return null;

  const updated = await db
    .update(projectMembers)
    .set({ role: resolvedRole })
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, memberUserId),
      ),
    )
    .returning({ id: projectMembers.id });
  if (updated.length === 0) return null;

  const [user] = await db
    .select({ name: users.name, email: users.email, image: users.image })
    .from(users)
    .where(eq(users.id, memberUserId))
    .limit(1);
  const memberName = user?.name?.trim() || user?.email || "Unbekannt";

  // Activity row only — a role change is not one of the four §10.2
  // notification triggers. Promoting somebody to Projektleiter is the
  // membership change most worth having a record of, and it was the only one
  // that used to leave no trace at all. `memberName` travels in the payload
  // so describeActivityEvent can render the line without a second lookup.
  await recordProjectEvent({
    workspaceId,
    projectId,
    projectName: project.name,
    eventType: "project.member_role_changed",
    actorId: userId,
    title: "Rolle geändert",
    body: `${memberName} ist jetzt ${resolvedRole} in "${project.name}".`,
    payload: { memberUserId, memberName, role: resolvedRole },
  });

  return toProjectMemberData({
    userId: memberUserId,
    role: resolvedRole,
    name: user?.name ?? null,
    email: user?.email ?? null,
    image: user?.image ?? null,
  });
}

export async function removeProjectMember(
  workspaceId: string,
  projectId: string,
  /** Who is doing this — the actor of the activity row. */
  userId: string,
  /** Who is being removed — the subject. */
  memberUserId: string,
): Promise<boolean> {
  const project = await loadProject(workspaceId, projectId);
  if (!project) return false;

  const deleted = await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, memberUserId),
      ),
    )
    .returning({ id: projectMembers.id });
  if (deleted.length === 0) return false;

  // Not one of the four §10.2 notification triggers → activity row only.
  await recordProjectEvent({
    workspaceId,
    projectId,
    projectName: project.name,
    eventType: "project.member_removed",
    // The ACTOR, not the person who was removed.
    actorId: userId,
    title: "Projektmitglied entfernt",
    body: `Ein Mitglied wurde aus "${project.name}" entfernt.`,
    payload: { memberUserId },
  });
  return true;
}
