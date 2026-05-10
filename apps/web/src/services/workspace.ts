import { db } from "@/db";
import { workspaces, workspaceMembers, users, objects, attributes, statuses, selectOptions } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";

type Db = typeof db;

export interface SyncStandardObjectExtrasResult {
  objectsAdded: number;
  attributesAdded: number;
  optionsAdded: number;
  stagesAdded: number;
}

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

/**
 * Idempotent backfill of every standard object/attribute/select option/deal stage
 * declared in `STANDARD_OBJECTS` for the given workspace. Inserts only what is
 * missing — never deletes, never renames. Safe to run on every boot.
 *
 * Used by `seedWorkspaceObjects` (fresh workspaces), the boot hook
 * (`apps/web/src/instrumentation.ts`), and the admin endpoint
 * `POST /api/admin/sync-standard-objects` so existing workspaces pick up new
 * options like `Meta Ads` or new attributes like `utm_campaign` / `utm_content`.
 */
export async function syncStandardObjectExtras(
  workspaceId: string,
  client: Db = db
): Promise<SyncStandardObjectExtrasResult> {
  const result: SyncStandardObjectExtrasResult = {
    objectsAdded: 0,
    attributesAdded: 0,
    optionsAdded: 0,
    stagesAdded: 0,
  };

  for (const stdObj of STANDARD_OBJECTS) {
    let [object] = await client
      .select()
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, stdObj.slug)))
      .limit(1);

    if (!object) {
      [object] = await client
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
      result.objectsAdded++;
    }

    const existingAttrs = await client
      .select()
      .from(attributes)
      .where(eq(attributes.objectId, object.id));
    const existingBySlug = new Map(existingAttrs.map((a) => [a.slug, a]));
    let appendCursor = existingAttrs.reduce(
      (m, a) => (a.sortOrder > m ? a.sortOrder : m),
      -1
    );

    for (const attr of stdObj.attributes) {
      let attribute = existingBySlug.get(attr.slug) ?? null;

      if (!attribute) {
        appendCursor++;
        [attribute] = await client
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
            sortOrder: appendCursor,
          })
          .returning();
        existingBySlug.set(attr.slug, attribute);
        result.attributesAdded++;
      }

      if (attr.type === "select" && attr.selectOptions?.length) {
        const existingOpts = await client
          .select()
          .from(selectOptions)
          .where(eq(selectOptions.attributeId, attribute.id));
        const existingTitles = new Set(
          existingOpts.map((o) => o.title.toLowerCase())
        );
        let optMax = existingOpts.reduce(
          (m, o) => (o.sortOrder > m ? o.sortOrder : m),
          -1
        );
        for (const opt of attr.selectOptions) {
          if (existingTitles.has(opt.title.toLowerCase())) continue;
          optMax++;
          await client.insert(selectOptions).values({
            attributeId: attribute.id,
            title: opt.title,
            color: opt.color ?? "#6366f1",
            sortOrder: optMax,
          });
          existingTitles.add(opt.title.toLowerCase());
          result.optionsAdded++;
        }
      }

      if (stdObj.slug === "deals" && attr.slug === "stage") {
        const existingStages = await client
          .select()
          .from(statuses)
          .where(eq(statuses.attributeId, attribute.id));
        const existingStageTitles = new Set(
          existingStages.map((s) => s.title.toLowerCase())
        );
        for (const stage of DEAL_STAGES) {
          if (existingStageTitles.has(stage.title.toLowerCase())) continue;
          await client.insert(statuses).values({
            attributeId: attribute.id,
            title: stage.title,
            color: stage.color,
            sortOrder: stage.sortOrder,
            isActive: stage.isActive,
            celebrationEnabled: stage.celebrationEnabled,
          });
          existingStageTitles.add(stage.title.toLowerCase());
          result.stagesAdded++;
        }
      }
    }
  }

  return result;
}

/** Seed standard objects (People, Companies, Operating companies, Deals) + attributes + deal stages. */
export async function seedWorkspaceObjects(workspaceId: string) {
  await syncStandardObjectExtras(workspaceId);
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
