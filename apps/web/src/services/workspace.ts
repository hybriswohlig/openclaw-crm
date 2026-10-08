import { db } from "@/db";
import {
  workspaces,
  workspaceMembers,
  users,
  sessions,
  apiKeys,
  objects,
  attributes,
  statuses,
  selectOptions,
} from "@/db/schema";
import type { MemberPermissions } from "@/db/schema/workspace";
import { eq, and, asc, desc, ne, sql, isNull } from "drizzle-orm";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";
import { keepStoredSecrets } from "@/lib/workspace-secrets";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  return db.transaction(async (tx) => {
    let settings = input.settings;
    if (settings !== undefined) {
      // Clients sehen geheime Felder nie (toPublicWorkspace) und schicken die
      // Einstellungen ohne sie zurück. Ohne das würde jedes Speichern der
      // allgemeinen Einstellungen den OpenRouter-Schlüssel löschen.
      const [current] = await tx
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for("update");
      settings = keepStoredSecrets(settings, current?.settings);
    }

    const [updated] = await tx
      .update(workspaces)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(settings !== undefined && { settings }),
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return updated;
  });
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
): Promise<{
  workspaceId: string;
  role: "admin" | "member";
  permissions: MemberPermissions;
} | null> {
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
    return {
      workspaceId,
      role: existing.role,
      permissions: existing.permissions ?? {},
    };
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const memberCount = countRow?.count ?? 0;
  const role: "admin" | "member" =
    isAppAdmin || memberCount === 0 ? "admin" : "member";

  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
  return { workspaceId, role, permissions: {} };
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
      permissions: workspaceMembers.permissions,
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

/**
 * Ändert die Rolle eines Mitglieds, macht aber nie den letzten Admin zum
 * Mitglied: sonst könnte niemand mehr das Team verwalten. Gibt die geänderte
 * Mitgliedschaft zurück, oder null, wenn es sie in diesem Workspace nicht gibt.
 */
export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: "admin" | "member"
) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: workspaceMembers.id, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, memberId),
          eq(workspaceMembers.workspaceId, workspaceId)
        )
      )
      .limit(1);

    if (!member) return null;

    if (
      member.role === "admin" &&
      role !== "admin" &&
      !(await bleibtEinAdmin(tx, workspaceId, member.id))
    ) {
      throw new Error("Der letzte Admin kann nicht zum Mitglied gemacht werden.");
    }

    const [updated] = await tx
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
  });
}

/**
 * Merge-patch a member's granular permissions. Unspecified keys are left
 * alone; pass `{ key: false }` to revoke. The whole JSONB column is
 * rewritten because Postgres doesn't have a partial-update primitive for
 * JSONB through Drizzle without raw SQL.
 */
export async function updateMemberPermissions(
  workspaceId: string,
  memberId: string,
  patch: MemberPermissions
) {
  const [existing] = await db
    .select({ permissions: workspaceMembers.permissions })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!existing) return null;

  const merged: MemberPermissions = { ...(existing.permissions ?? {}), ...patch };
  // Strip explicit `false`/`undefined` so the JSONB stays compact.
  for (const k of Object.keys(merged) as (keyof MemberPermissions)[]) {
    if (merged[k] === false || merged[k] === undefined) delete merged[k];
  }

  const [updated] = await db
    .update(workspaceMembers)
    .set({ permissions: merged })
    .where(
      and(
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .returning();
  return updated ?? null;
}

/**
 * Nimmt einem Benutzer den Zugang zum CRM, wie beim Ablehnen einer
 * Registrierung: Freigabe auf „rejected“, Sitzungen und Mitgliedschaften
 * gelöscht, offene API-Schlüssel gesperrt. Die Freigabe ist der entscheidende
 * Teil: getAuthContext legt freigegebene Benutzer ohne Mitgliedschaft bei der
 * nächsten Anfrage automatisch wieder als Mitglied an (ensureUserWorkspaceAccess).
 */
export async function revokeUserAccess(
  executor: DbExecutor,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  await executor
    .update(users)
    .set({ approvalStatus: "rejected", updatedAt: now })
    .where(eq(users.id, userId));
  await executor.delete(sessions).where(eq(sessions.userId, userId));
  await executor
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  await executor
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
}

/**
 * Entfernt ein Mitglied und nimmt ihm damit den Zugang (revokeUserAccess).
 * Sich selbst, den letzten Admin und den letzten App-Admin (gibt Konten frei)
 * kann niemand entfernen. Gibt die gelöschte Mitgliedschaft zurück, oder null,
 * wenn es sie in diesem Workspace nicht gibt.
 */
export async function removeMember(
  workspaceId: string,
  memberId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, memberId),
          eq(workspaceMembers.workspaceId, workspaceId)
        )
      )
      .limit(1);

    if (!member) return null;

    if (member.userId === actorUserId) {
      throw new Error("Du kannst dich nicht selbst entfernen.");
    }

    if (
      member.role === "admin" &&
      !(await bleibtEinAdmin(tx, workspaceId, member.id))
    ) {
      throw new Error("Der letzte Admin kann nicht entfernt werden.");
    }

    // Nur App-Admins geben Konten frei, auch gesperrte wieder. Ginge der
    // letzte, käme niemand mehr an „Benutzer-Freigaben“.
    const [konto] = await tx
      .select({ isAppAdmin: users.isAppAdmin })
      .from(users)
      .where(eq(users.id, member.userId))
      .limit(1);
    if (konto?.isAppAdmin && !(await bleibtEinAppAdmin(tx, member.userId))) {
      throw new Error(
        "Der letzte Admin für Benutzer-Freigaben kann nicht entfernt werden."
      );
    }

    await revokeUserAccess(tx, member.userId);
    return member;
  });
}

/**
 * Sperrt die Admin-Zeilen des Workspace (FOR UPDATE) und sagt, ob außer
 * diesem Mitglied noch ein Admin bleibt. Entfernen oder herabstufen sich zwei
 * Admins gleichzeitig gegenseitig, wartet die zweite Transaktion und sieht
 * danach nur noch einen Admin.
 */
async function bleibtEinAdmin(
  executor: DbExecutor,
  workspaceId: string,
  memberId: string
): Promise<boolean> {
  const admins = await executor
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "admin")
      )
    )
    .for("update");
  return admins.some((a) => a.id !== memberId);
}

/**
 * Sperrt die Konten aller freigegebenen App-Admins (FOR UPDATE) und sagt, ob
 * außer diesem Benutzer noch einer bleibt. Gesperrte App-Admins zählen nicht,
 * getAppAdminFromRequest lässt sie nicht herein.
 */
async function bleibtEinAppAdmin(
  executor: DbExecutor,
  userId: string
): Promise<boolean> {
  const appAdmins = await executor
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAppAdmin, true), eq(users.approvalStatus, "approved")))
    .for("update");
  return appAdmins.some((a) => a.id !== userId);
}

// ─── Freigaben ───────────────────────────────────────────────────────

/**
 * Gesperrte Konten für „Benutzer-Freigaben“: abgelehnte Registrierungen und
 * aus dem Team entfernte Mitglieder (beides „rejected“), zuletzt gesperrte
 * zuerst. Konten fürs Mitarbeiterportal fehlen, sie bekommen nie Zugang zum CRM.
 */
export async function listRejectedUsers() {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.approvalStatus, "rejected"), ne(users.role, "employee")))
    .orderBy(desc(users.updatedAt));
}

/**
 * Gibt eine neue Registrierung („pending“) frei oder ein gesperrtes Konto
 * („rejected“) wieder frei. Mehr braucht es nicht: Nach der nächsten Anmeldung
 * legt getAuthContext die Mitgliedschaft an (ensureUserWorkspaceAccess).
 * Sitzungen und API-Schlüssel von vor der Sperre bleiben gelöscht bzw. gesperrt.
 * Gibt null zurück, wenn es das Konto nicht gibt.
 */
export async function approveUser(
  userId: string,
  now: Date = new Date()
): Promise<{ id: string; approvalStatus: "approved" } | null> {
  const [konto] = await db
    .select({ approvalStatus: users.approvalStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!konto) return null;

  if (konto.approvalStatus !== "approved") {
    await db
      .update(users)
      .set({ approvalStatus: "approved", updatedAt: now })
      .where(eq(users.id, userId));
  }

  return { id: userId, approvalStatus: "approved" };
}
