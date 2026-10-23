import { db } from "@/db";
import {
  workspaces,
  workspaceMembers,
  users,
  sessions,
  apiKeys,
  pushSubscriptions,
  calendarFeedTokens,
  objects,
  attributes,
  statuses,
  selectOptions,
} from "@/db/schema";
import type { MemberPermissions } from "@/db/schema/workspace";
import { eq, and, asc, desc, ne, sql, isNull } from "drizzle-orm";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";
import { keepStoredSecrets } from "@/lib/workspace-secrets";

type Transaktion = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/**
 * Abgelehnt, weil danach ein Workspace keinen Admin oder das CRM keinen
 * freigegebenen App-Admin mehr hätte. Die Routen antworten mit 409 und diesem
 * Text, die Seiten „Mitglieder“ und „Benutzer-Freigaben“ zeigen ihn an.
 */
export class LetzterAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LetzterAdminError";
  }
}

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
 * Mitglied: sonst könnte niemand mehr das Team verwalten (LetzterAdminError).
 * Gibt die geänderte Mitgliedschaft zurück, oder null, wenn es sie in diesem
 * Workspace nicht gibt.
 */
export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: "admin" | "member"
) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, memberId),
          eq(workspaceMembers.workspaceId, workspaceId)
        )
      )
      .limit(1);

    if (!member) return null;

    // Ob er Admin ist, entscheiden erst die gesperrten Admin-Zeilen, nicht
    // die Lesung oben (siehe sperreAdmins).
    if (role !== "admin") {
      const admins = await sperreAdmins(tx, workspaceId);
      if (istLetzter(admins.map((a) => a.id), member.id)) {
        throw new LetzterAdminError(
          "Der letzte Admin kann nicht zum Mitglied gemacht werden."
        );
      }
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

/** Wie einem Benutzer der Zugang genommen wird, so steht es in der Ablehnung. */
type Zugangsentzug = "entfernt" | "abgelehnt";

/**
 * Nimmt einem Benutzer den Zugang zum CRM, wie beim Ablehnen einer
 * Registrierung: Freigabe auf „rejected“, Sitzungen, Push-Abos und
 * Mitgliedschaften gelöscht, offene API-Schlüssel und Kalender-Feeds gesperrt. Die Freigabe ist
 * der entscheidende Teil: getAuthContext legt freigegebene Benutzer ohne
 * Mitgliedschaft bei der nächsten Anfrage automatisch wieder als Mitglied an
 * (ensureUserWorkspaceAccess). Die Push-Abos gehören dazu, weil Pushes
 * Kundennamen und Nachrichtenvorschauen zeigen.
 *
 * Vorher prüft sie in derselben Transaktion, dass danach jeder Workspace noch
 * einen Admin und das CRM noch einen freigegebenen App-Admin hat, und wirft
 * sonst LetzterAdminError (pruefeAdminsBleiben). Die Prüfung steckt hier
 * drin, damit kein Aufrufer sie vergessen kann.
 */
export async function revokeUserAccess(
  tx: Transaktion,
  userId: string,
  vorgang: Zugangsentzug,
  now: Date = new Date(),
  akteurUserId?: string
): Promise<void> {
  await pruefeAdminsBleiben(tx, userId, vorgang, akteurUserId);

  await tx
    .update(users)
    .set({ approvalStatus: "rejected", updatedAt: now })
    .where(eq(users.id, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  await tx
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  // Der Kalender-Feed (ICS) zeigt Kundenadressen und braucht keine Sitzung.
  await tx
    .update(calendarFeedTokens)
    .set({ revokedAt: now })
    .where(and(eq(calendarFeedTokens.userId, userId), isNull(calendarFeedTokens.revokedAt)));
  await tx
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
}

/**
 * Entfernt ein Mitglied und nimmt ihm damit den Zugang (revokeUserAccess).
 * Sich selbst kann niemand entfernen; den letzten Admin und den letzten
 * App-Admin (gibt Konten frei) lehnt revokeUserAccess ab. Gibt die gelöschte
 * Mitgliedschaft zurück, oder null, wenn es sie in diesem Workspace nicht gibt.
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

    await revokeUserAccess(tx, member.userId, "entfernt", new Date(), actorUserId);
    return member;
  });
}

/**
 * Wirft LetzterAdminError, wenn dieser Benutzer in einem seiner Workspaces
 * der letzte Admin ist oder der letzte freigegebene App-Admin. Läuft in der
 * Transaktion von revokeUserAccess, vor dem ersten Schreiben.
 *
 * Erst sperren, dann entscheiden: Ob er Admin ist, sagen die gesperrten
 * Zeilen, nicht eine frühere Lesung. Sonst könnte er zwischen Lesen und
 * Löschen Admin werden, während ein anderer Admin sich genau darauf verlässt
 * und zum Mitglied gemacht wird.
 */
async function pruefeAdminsBleiben(
  tx: Transaktion,
  userId: string,
  vorgang: Zugangsentzug,
  akteurUserId?: string
): Promise<void> {
  // revokeUserAccess löscht jede Mitgliedschaft des Benutzers, also zählt
  // jeder seiner Workspaces, nicht nur der, aus dem er entfernt wird.
  const mitgliedschaften = await tx
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.workspaceId));
  for (const { workspaceId } of mitgliedschaften) {
    const admins = await sperreAdmins(tx, workspaceId);
    if (istLetzter(admins.map((a) => a.userId), userId)) {
      throw new LetzterAdminError(`Der letzte Admin kann nicht ${vorgang} werden.`);
    }
  }

  // Nur App-Admins geben Konten frei, auch gesperrte wieder. Ginge der
  // letzte, käme niemand mehr an „Benutzer-Freigaben“. isAppAdmin ändert sich
  // nach dem Anlegen des Kontos nicht mehr, die Freigabe schon: Darum zählen
  // auch hier nur die gesperrten Zeilen.
  const [konto] = await tx
    .select({ isAppAdmin: users.isAppAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (konto?.isAppAdmin) {
    // Workspace-Admin ist eine Rolle, die jeder Admin vergeben kann. Ein
    // App-Admin gibt Konten frei; ihn sperrt nur ein anderer App-Admin.
    if (akteurUserId) {
      const [akteur] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, akteurUserId),
            eq(users.isAppAdmin, true),
            eq(users.approvalStatus, "approved")
          )
        )
        .limit(1);
      if (!akteur) {
        throw new Error(
          "Einen App-Admin kann nur ein App-Admin entfernen. Er kann das Konto unter „Benutzer-Freigaben“ sperren."
        );
      }
    }
    const appAdmins = await sperreAppAdmins(tx);
    if (istLetzter(appAdmins.map((a) => a.id), userId)) {
      throw new LetzterAdminError(
        `Der letzte Admin für Benutzer-Freigaben kann nicht ${vorgang} werden.`
      );
    }
  }
}

/**
 * Sperrt die Admin-Mitgliedschaften des Workspace (FOR UPDATE) und gibt sie
 * zurück. Wer einem Admin die Rolle oder den Zugang nimmt (entfernen,
 * ablehnen, zum Mitglied machen), sperrt sie zuerst: Tun zwei Anfragen das
 * gleichzeitig, wartet die zweite Transaktion und sieht danach den Stand nach
 * der ersten. Nach id geordnet, damit alle in derselben Reihenfolge sperren.
 */
async function sperreAdmins(
  tx: Transaktion,
  workspaceId: string
): Promise<Array<{ id: string; userId: string }>> {
  return tx
    .select({ id: workspaceMembers.id, userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "admin")
      )
    )
    .orderBy(asc(workspaceMembers.id))
    .for("update");
}

/**
 * Sperrt die Konten aller freigegebenen App-Admins (FOR UPDATE) und gibt sie
 * zurück, wie sperreAdmins. Gesperrte App-Admins zählen nicht,
 * getAppAdminFromRequest lässt sie nicht herein.
 */
async function sperreAppAdmins(tx: Transaktion): Promise<Array<{ id: string }>> {
  return tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAppAdmin, true), eq(users.approvalStatus, "approved")))
    .orderBy(asc(users.id))
    .for("update");
}

/** Steht diese ID in der Liste und keine andere? Dann ist sie die letzte. */
function istLetzter(ids: string[], id: string): boolean {
  return ids.includes(id) && ids.every((andere) => andere === id);
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

/**
 * „Ablehnen“ unter Benutzer-Freigaben: nimmt dem Konto in einer Transaktion
 * den Zugang (revokeUserAccess), wie „Mitglied entfernen“. Auch hier bleiben
 * der letzte Admin jedes Workspace und der letzte App-Admin (LetzterAdminError),
 * selbst wenn ein App-Admin ablehnt, der im Team nur Mitglied ist. Gibt null
 * zurück, wenn es das Konto nicht gibt.
 */
export async function rejectUser(
  userId: string,
  now: Date = new Date()
): Promise<{ id: string; approvalStatus: "rejected" } | null> {
  return db.transaction(async (tx) => {
    const [konto] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!konto) return null;

    await revokeUserAccess(tx, userId, "abgelehnt", now);
    return { id: userId, approvalStatus: "rejected" as const };
  });
}
