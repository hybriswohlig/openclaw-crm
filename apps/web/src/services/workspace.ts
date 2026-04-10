import { db } from "@/db";
import { workspaces, workspaceMembers, users, objects, attributes, statuses, selectOptions } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";

// ─── Workspace ───────────────────────────────────────────────────────

export async function getWorkspace(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; settings?: Record<string, unknown> }
) {
  const [updated] = await db
    .update(workspaces)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.settings !== undefined && { settings: input.settings }),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated;
}

/** The single CRM workspace for this deployment (oldest row). */
export async function getSingletonWorkspaceId(): Promise<string | null> {
  const [w] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  return w?.id ?? null;
}

/**
 * Ensure an approved user has a membership on the singleton workspace.
 * First member (or bootstrap app admin) becomes workspace admin.
 */
export async function ensureUserWorkspaceAccess(
  userId: string,
  isAppAdmin: boolean
): Promise<{ workspaceId: string; role: "admin" | "member" } | null> {
  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return null;

  const [existing] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);

  if (existing) {
    return { workspaceId, role: existing.role };
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const memberCount = countRow?.count ?? 0;
  const role: "admin" | "member" =
    isAppAdmin || memberCount === 0 ? "admin" : "member";

  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
  return { workspaceId, role };
}

/** List workspace membership for this user (0 or 1 row in single-tenant mode). */
export async function listUserWorkspaces(userId: string) {
  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return [];

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .orderBy(workspaces.createdAt);

  return rows;
}

/** Seed standard objects (People, Companies, Operating companies, Deals) + attributes + deal stages */
export async function seedWorkspaceObjects(workspaceId: string) {
  for (const stdObj of STANDARD_OBJECTS) {
    const [object] = await db
      .insert(objects)
      .values({
        workspaceId,
        slug: stdObj.slug,
        singularName: stdObj.singularName,
        pluralName: stdObj.pluralName,
        icon: stdObj.icon,
        isSystem: true,
      })
      .returning();

    for (let i = 0; i < stdObj.attributes.length; i++) {
      const attr = stdObj.attributes[i];
      const [attribute] = await db
        .insert(attributes)
        .values({
          objectId: object.id,
          slug: attr.slug,
          title: attr.title,
          type: attr.type,
          config: attr.config || {},
          isSystem: attr.isSystem,
          isRequired: attr.isRequired,
          isUnique: attr.isUnique,
          isMultiselect: attr.isMultiselect,
          sortOrder: i,
        })
        .returning();

      if (attr.type === "select" && attr.selectOptions?.length) {
        for (let j = 0; j < attr.selectOptions.length; j++) {
          const opt = attr.selectOptions[j]!;
          await db.insert(selectOptions).values({
            attributeId: attribute.id,
            title: opt.title,
            color: opt.color ?? "#6366f1",
            sortOrder: j,
          });
        }
      }

      // Create deal stages for the "stage" status attribute
      if (stdObj.slug === "deals" && attr.slug === "stage") {
        for (const stage of DEAL_STAGES) {
          await db.insert(statuses).values({
            attributeId: attribute.id,
            title: stage.title,
            color: stage.color,
            sortOrder: stage.sortOrder,
            isActive: stage.isActive,
            celebrationEnabled: stage.celebrationEnabled,
          });
        }
      }
    }
  }
}

// ─── Members ─────────────────────────────────────────────────────────

export async function listMembers(workspaceId: string) {
  return db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.createdAt);
}

export async function addMemberByEmail(
  workspaceId: string,
  email: string,
  role: "admin" | "member" = "member"
) {
  // Find user by email
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (userRows.length === 0) {
    throw new Error("No user found with that email address");
  }

  const user = userRows[0];

  if (user.approvalStatus !== "approved") {
    throw new Error("User must be approved before they can be added to the team");
  }

  // Check if already a member
  const existing = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("User is already a member of this workspace");
  }

  const [member] = await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: user.id, role })
    .returning();

  return {
    ...member,
    userName: user.name,
    userEmail: user.email,
    userImage: user.image,
  };
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: "admin" | "member"
) {
  const [updated] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .returning();
  return updated ?? null;
}

export async function removeMember(workspaceId: string, memberId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (rows.length === 0) return null;

  // Don't allow removing the last admin
  if (rows[0].role === "admin") {
    const adminCount = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.role, "admin")
        )
      );
    if (adminCount.length <= 1) {
      throw new Error("Cannot remove the last admin");
    }
  }

  await db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.id, memberId));

  return rows[0];
}
