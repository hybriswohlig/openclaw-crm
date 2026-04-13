import { db } from "@/db";
import { workspaces, workspaceMembers, users, objects, attributes, statuses, selectOptions, teams } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";

const BUILTIN_TEAMS = [
  { key: "ne_germany", name: "N&E Germany" },
  { key: "ne_france", name: "N&E France" },
  { key: "ne_uk", name: "N&E UK" },
  { key: "ne_singapore", name: "N&E Singapore" },
];

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

/**
 * Ensure the given user has at least one workspace membership.
 * Called from getAuthContext (self-heal) and the after-signup hook so an
 * approved user always lands in a ready-to-use workspace.
 *
 * Idempotent: if the user already has a membership, does nothing.
 */
export async function ensureBootstrapWorkspace(
  userId: string,
  email: string | null | undefined,
  name: string | null | undefined
): Promise<string | null> {
  // Fast-path: already has a membership
  const existing = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].workspaceId;
  }

  const displayName = (name || email?.split("@")[0] || "User").trim();
  const workspaceName = `${displayName}'s Workspace`;
  const baseSlug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;

  try {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: workspaceName, slug, settings: {} })
      .returning();

    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId, role: "admin" })
      .onConflictDoNothing();

    await seedWorkspaceObjects(workspace.id);
    await seedWorkspaceTeams(workspace.id);

    return workspace.id;
  } catch (err) {
    // Race condition fallback: another request might have created it
    const retry = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    if (retry.length > 0) return retry[0].workspaceId;
    console.error("[ensureBootstrapWorkspace] failed", err);
    return null;
  }
}

/** Create a new workspace with the creator as admin, and seed standard objects */
export async function createWorkspace(name: string, userId: string) {
  const existingMembership = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);

  if (existingMembership.length > 0) {
    throw new Error("ALREADY_HAS_WORKSPACE");
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "workspace";

  // Ensure slug uniqueness by appending random suffix
  const existingSlugs = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);

  const finalSlug = existingSlugs.length > 0
    ? `${slug}-${crypto.randomUUID().slice(0, 8)}`
    : slug;

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name,
      slug: finalSlug,
      settings: {},
    })
    .returning();

  // Add creator as admin
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId,
    role: "admin",
  });

  // Seed standard objects
  await seedWorkspaceObjects(workspace.id);

  return workspace;
}

/** List all workspaces a user is a member of */
export async function listUserWorkspaces(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
}

/** Seed the four built-in N&E regional teams for a new workspace. */
export async function seedWorkspaceTeams(workspaceId: string) {
  for (const team of BUILTIN_TEAMS) {
    await db.insert(teams).values({ workspaceId, key: team.key, name: team.name }).onConflictDoNothing();
  }
}

/**
 * Seed standard objects (Contacts, Companies, Leads) + attributes + stages.
 * Idempotent: skips objects/attributes that already exist so it is safe to
 * call on an existing workspace to repair or update its schema.
 */
export async function seedWorkspaceObjects(workspaceId: string) {
  for (const stdObj of STANDARD_OBJECTS) {
    // Upsert the object itself
    const existing = await db
      .select()
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, stdObj.slug)))
      .limit(1);

    let object = existing[0];
    if (!object) {
      const [inserted] = await db
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
      object = inserted;
    }

    for (let i = 0; i < stdObj.attributes.length; i++) {
      const attr = stdObj.attributes[i];

      // Upsert the attribute
      const existingAttr = await db
        .select()
        .from(attributes)
        .where(and(eq(attributes.objectId, object.id), eq(attributes.slug, attr.slug)))
        .limit(1);

      let attribute = existingAttr[0];
      if (!attribute) {
        const [inserted] = await db
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
        attribute = inserted;

        // Seed status options for stage attributes
        if (attr.type === "status" && stdObj.slug === "deals" && attr.slug === "stage") {
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

        // Seed select options for select attributes
        if (attr.type === "select" && attr.selectOptions) {
          for (let j = 0; j < attr.selectOptions.length; j++) {
            const opt = attr.selectOptions[j];
            await db.insert(selectOptions).values({
              attributeId: attribute.id,
              title: opt.title,
              color: opt.color,
              sortOrder: j,
            });
          }
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
