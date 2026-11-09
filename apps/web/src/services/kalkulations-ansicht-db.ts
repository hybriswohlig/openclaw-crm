/**
 * DB-Lader der Kalkulationsseite (nur lesen). Jede Abfrage filtert auf den
 * Workspace; `services/kalkulations-ansicht.ts` lädt dieses Modul erst beim Aufruf.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { offerPackages } from "@/db/schema/customer-portal";
import { dealDocuments } from "@/db/schema/financial";
import { zeilen } from "@/lib/db-werte";

/** Name des Deals (Attribut `name`) und seine Betriebsfirma (`operating_company`). */
export async function ladeDealKopf(ws: string, deal: string): Promise<{ name: string | null; firmaId: string | null }> {
  const res = await db.execute(sql`
    SELECT
      (
        SELECT v.text_value FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'name'
        WHERE v.record_id = r.id
        LIMIT 1
      ) AS name,
      (
        SELECT v.referenced_record_id FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'operating_company'
        WHERE v.record_id = r.id
        LIMIT 1
      ) AS firma_id
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE r.id = ${deal} AND r.deleted_at IS NULL
  `);
  const [k] = zeilen<{ name: string | null; firma_id: string | null }>(res);
  return { name: k?.name ?? null, firmaId: k?.firma_id ?? null };
}

/** Neuester KV (`deal_documents`, Typ quotation), der aus genau dieser Version entstand. */
export async function ladeKvDokument(ws: string, deal: string, versionId: string): Promise<{ id: string; fileName: string } | null> {
  const [row] = await db
    .select({ id: dealDocuments.id, fileName: dealDocuments.fileName })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.workspaceId, ws),
        eq(dealDocuments.dealRecordId, deal),
        eq(dealDocuments.documentType, "quotation"),
        eq(dealDocuments.calculationVersionId, versionId)
      )
    )
    .orderBy(desc(dealDocuments.uploadedAt))
    .limit(1);
  return row ?? null;
}

/** userId → Name (Nutzer sind workspace-übergreifend; gelesen wird nur der Name). */
export async function ladeNutzerNamen(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** Paket-Slug → Anzeigename, aus den Paketen der Firma des Deals. */
export async function ladePaketNamen(ws: string, deal: string): Promise<Record<string, string>> {
  const { resolveDealOperatingCompany } = await import("./financial");
  const firma = await resolveDealOperatingCompany(ws, deal);
  if (!firma) return {};
  const rows = await db
    .select({ slug: offerPackages.slug, name: offerPackages.displayName })
    .from(offerPackages)
    .where(and(eq(offerPackages.workspaceId, ws), eq(offerPackages.operatingCompanyRecordId, firma)));
  return Object.fromEntries(rows.map((r) => [r.slug, r.name]));
}

/**
 * Plan 15 (Bauteil 2): letzte Adresse je Seite, die die Kalkulation ins Lead
 * geschrieben hat (Ereignis `kalkulation.adresse_gesetzt`), mit Autor und Zeit.
 */
export async function ladeAdressGesetzt(
  ws: string,
  deal: string
): Promise<Partial<Record<"beladen" | "entladen", { adresse: string; userId: string | null; am: string }>>> {
  const { activityEvents } = await import("@/db/schema");
  const { ADRESSE_GESETZT_EVENT } = await import("@/lib/kalkulation-p15");
  const rows = await db
    .select({ payload: activityEvents.payload, actorId: activityEvents.actorId, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(and(eq(activityEvents.workspaceId, ws), eq(activityEvents.recordId, deal), eq(activityEvents.eventType, ADRESSE_GESETZT_EVENT)))
    .orderBy(desc(activityEvents.createdAt))
    .limit(20);
  const aus: Partial<Record<"beladen" | "entladen", { adresse: string; userId: string | null; am: string }>> = {};
  for (const r of rows) {
    const p = r.payload as { seite?: unknown; adresse?: unknown };
    if ((p.seite === "beladen" || p.seite === "entladen") && typeof p.adresse === "string" && !aus[p.seite]) {
      aus[p.seite] = { adresse: p.adresse, userId: r.actorId ?? null, am: r.createdAt.toISOString() };
    }
  }
  return aus;
}

/** Plan 15 (Bauteil 14): letzte Korrektur je Inventarzeile (Ereignis `inventar.korrigiert`), mit Autor und Zeit. */
export async function ladeInventarKorrekturen(ws: string, deal: string): Promise<Record<string, { userId: string | null; am: string }>> {
  const { activityEvents } = await import("@/db/schema");
  const rows = await db
    .select({ payload: activityEvents.payload, actorId: activityEvents.actorId, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(and(eq(activityEvents.workspaceId, ws), eq(activityEvents.recordId, deal), eq(activityEvents.eventType, "inventar.korrigiert")))
    .orderBy(desc(activityEvents.createdAt))
    .limit(300);
  const aus: Record<string, { userId: string | null; am: string }> = {};
  for (const r of rows) {
    const id = (r.payload as { itemId?: unknown }).itemId;
    if (typeof id === "string" && !aus[id]) aus[id] = { userId: r.actorId ?? null, am: r.createdAt.toISOString() };
  }
  return aus;
}
