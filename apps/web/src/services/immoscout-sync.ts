/**
 * ImmobilienScout / umzug-easy lead sync.
 *
 * Fetches relocation request leads from the umzug-easy.de REST API and
 * upserts them into the CRM as People + Deal records.
 *
 * API docs: "Relocation request export REST API" (ImmoScout24)
 *
 * Endpoints used:
 *   GET  /api/reset          — reset all imported flags (makes all leads re-fetchable)
 *   GET  /api/listrequests   — list aids that have NOT yet been marked as imported
 *   GET  /api/request/{aid}  — fetch full lead detail
 *   POST /api/request        — mark a lead as imported (status=1)
 *
 * Deduplication: based on the ImportId stored in deal's moving_lead_payload.externalId.
 */

import { db } from "@/db";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { integrations } from "@/db/schema/integrations";
import { eq, and, sql } from "drizzle-orm";
import { createRecord, updateRecord } from "./records";
import { resolveOrCreatePerson } from "./inbox-crm-link";
import { assignDealNumber } from "./financial";
import { computeLeadName } from "./lead-name";
import { updateIntegration } from "./integrations";

const API_BASE = "https://www.umzug-easy.de/api";

// ─── Types ───────────────────────────────────────────────────────────

/** Each entry in the /listrequests response */
interface LeadListEntry {
  aid: string;
}

/** Full lead detail from /request/{aid} */
interface LeadDetail {
  // Lead metadata
  ImportId: string;
  Id: number;
  LeadType: string; // umzug, fmz, klavier, lager, beiladung, entruempelung
  CreatedAt: string;
  PremiumLead: boolean;

  // Client (Auftraggeber) — _A suffix
  Anrede_A: number; // 1=none, 2=woman, 3=family, 4=company, 5=man, 6=office
  Name_A: string;
  Vorname_A: string;
  Strasse_A: string;
  PLZ_A: number | string;
  Ort_A: string;
  Land_A: number | string;
  Telefon_A: string;
  Telefon2_A: string;
  Fax_A: string;
  Mail_A: string;
  Bemerkung_A: string;

  // Loading address (Beladeadresse) — _BL suffix
  Anrede_BL: number;
  Name_BL: string;
  Vorname_BL: string;
  Strasse_BL: string;
  PLZ_BL: number | string;
  Ort_BL: string;
  Land_BL: number | string;
  Etage_BL: string | number;
  Wohnflache_BL: number | string;
  Aufzug_BL: boolean;
  Bemerkung_BL: string;
  Zimmer_BL: string | number;
  Personen_BL: number | string;
  Keller_BL: boolean;
  Dachboden_BL: boolean;

  // Unloading address (Entladeadresse) — _EL suffix
  Anrede_EL: number;
  Name_EL: string;
  Vorname_EL: string;
  Strasse_EL: string;
  PLZ_EL: number | string;
  Ort_EL: string;
  Land_EL: number | string;
  Etage_EL: string | number;
  Wohnflache_EL: number | string;
  Aufzug_EL: boolean;
  Bemerkung_EL: string;
  Personen_EL: number | string;
  Keller_EL: boolean;
  Dachboden_EL: boolean;

  // Dates
  WunschterminVon: string; // YYYY-MM-DD
  WunschterminBis: string;
  Alternativtermin: boolean;

  // Services
  Einpacken: boolean;
  Auspacken: boolean;
  Moebelmontage_BL: boolean;
  Moebelmontage_EL: boolean;
  Kuechenmontage_BL: boolean;
  Kuechenmontage_EL: boolean;
  Moebeldemontage: boolean;
  Moebelremontage: boolean;
  KartonsEinpacken: boolean;
  KartonsAuspacken: boolean;
  Elektroarbeiten: boolean;
  MoebleEinlagern: boolean;
  Entsorgung_BL: boolean;

  // UGL (moving goods list)
  UGLVorhanden: boolean;
  UGLString: string;
  UGLVolumen: number;
  Freitext_UGL: string;
  Foto_UGL?: string[];
  Foto_UGL_Kommentar: string;

  // Distances / dimensions
  Distance: number;
  GanzesHausBL: boolean;
  GanzesHausEL: boolean;
  KartonSumme: string | number;

  // Enums
  AufzugGroesse_BL: string;
  AufzugGroesse_EL: string;
  Trageweg_BL: string;
  Trageweg_EL: string;
  AnzahlDerBewohner: string;
  Zahlungsart: string; // bez_priv, bez_ag, bez_beh
  BezahltVon?: string;

  // Other
  Besichtigungstermin: boolean;
  Terrasse_BL: boolean;
  Balkon_BL: boolean;
  Umzugkartons_BL: boolean;
  Verpackungsmaterial_BL: boolean;

  // UGL structured data (optional)
  Ugl?: unknown;

  [key: string]: unknown;
}

export interface SyncResult {
  total: number;
  created: number;
  skipped: number;
  errors: string[];
}

// ─── Salutation Map ──────────────────────────────────────────────────

const SALUTATION_MAP: Record<number, string> = {
  1: "",
  2: "Frau",
  3: "Familie",
  4: "Firma",
  5: "Herr",
  6: "Büro",
};

// ─── API Helpers ─────────────────────────────────────────────────────

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** Reset all imported flags so /listrequests returns everything */
export async function resetImportedFlags(apiKey: string): Promise<void> {
  const res = await fetch(`${API_BASE}/reset`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`umzug-easy /reset failed: ${res.status}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}

/** Fetch list of un-imported lead AIDs */
async function fetchLeadList(apiKey: string): Promise<LeadListEntry[]> {
  const res = await fetch(`${API_BASE}/listrequests`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`umzug-easy /listrequests failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data.error) throw new Error(data.error);
  return [];
}

/** Fetch full detail for a single lead */
async function fetchLeadDetail(apiKey: string, aid: string): Promise<LeadDetail> {
  const res = await fetch(`${API_BASE}/request/${aid}`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`umzug-easy /request/${aid} failed: ${res.status}`);
  }
  return res.json();
}

/** Mark a lead as imported on umzug-easy side */
async function markAsImported(apiKey: string, aid: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/request`, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `aid=${aid}&status=1`,
    });
  } catch {
    // Non-critical — don't fail the import if marking fails
  }
}

// ─── Sync Logic ──────────────────────────────────────────────────────

export async function syncImmoscoutLeads(
  workspaceId: string,
  apiKey: string,
  options: { resetFirst?: boolean } = {}
): Promise<SyncResult> {
  const result: SyncResult = { total: 0, created: 0, skipped: 0, errors: [] };

  // Optionally reset imported flags to re-fetch all leads
  if (options.resetFirst) {
    await resetImportedFlags(apiKey);
  }

  // 1. Fetch lead list (only un-imported leads)
  const leads = await fetchLeadList(apiKey);
  result.total = leads.length;

  if (leads.length === 0) return result;

  // 2. Resolve people + deals objects
  const [peopleObj, dealsObj] = await Promise.all([
    db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!peopleObj || !dealsObj) {
    result.errors.push("People or Deals object not found in workspace");
    return result;
  }

  // 3. Load attribute maps
  const [peopleAttrs, dealsAttrs] = await Promise.all([
    db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, peopleObj.id)),
    db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, dealsObj.id)),
  ]);

  const peopleAttrBySlug = new Map(peopleAttrs.map((a) => [a.slug, a.id]));
  const dealsAttrBySlug = new Map(dealsAttrs.map((a) => [a.slug, a.id]));

  // 4. Resolve "ImmobilienScout" lead_source option for people
  let leadSourceOptionId: string | null = null;
  const leadSourceAttrId = peopleAttrBySlug.get("lead_source");
  if (leadSourceAttrId) {
    const options = await db
      .select({ id: selectOptions.id, title: selectOptions.title })
      .from(selectOptions)
      .where(eq(selectOptions.attributeId, leadSourceAttrId));
    const match = options.find((o) => o.title === "ImmobilienScout");
    leadSourceOptionId = match?.id ?? null;
  }

  // 5. Collect existing ImportIds to skip duplicates (from moving_lead_payload)
  const movingLeadAttrId = dealsAttrBySlug.get("moving_lead_payload");
  const existingExternalIds = new Set<string>();
  if (movingLeadAttrId) {
    const existingPayloads = await db
      .select({ jsonValue: recordValues.jsonValue })
      .from(recordValues)
      .where(eq(recordValues.attributeId, movingLeadAttrId));

    for (const row of existingPayloads) {
      const payload = row.jsonValue as Record<string, unknown> | null;
      if (payload?.externalId) {
        existingExternalIds.add(String(payload.externalId));
      }
    }
  }

  // 6. Process each lead
  for (const entry of leads) {
    const aid = entry.aid;

    // Skip already-imported leads (in our CRM)
    if (existingExternalIds.has(aid)) {
      result.skipped++;
      await markAsImported(apiKey, aid);
      continue;
    }

    try {
      const d = await fetchLeadDetail(apiKey, aid);

      // ── Extract client info (_A = Auftraggeber) ──
      const firstName = d.Vorname_A || "";
      const lastName = d.Name_A || "";
      const fullName = `${firstName} ${lastName}`.trim() || "Unbekannt";
      const email = d.Mail_A || "";
      const phone = d.Telefon_A || d.Telefon2_A || "";
      const salutation = SALUTATION_MAP[d.Anrede_A] || "";

      // ── Resolve to a golden person via the single ingest contract ──
      // KOT-IDENTITY: canonical dedup across all channels + identity graph +
      // deterministic auto-merge, replacing ImmoScout's own exact-match lookup
      // so it stops minting un-deduped duplicate people.
      const resolved = await resolveOrCreatePerson({
        workspaceId,
        contactId: null,
        displayName: fullName,
        email: email || null,
        phone: phone || null,
        leadSource: "ImmobilienScout",
        source: "import",
        trust: "verified",
      });
      let personRecordId = resolved.personRecordId;
      // ImmoScout-specific extras the generic contract does not set; only on a
      // freshly-created person, to avoid overwriting an existing record.
      if (resolved.isNew && personRecordId && (d.Ort_A || d.Strasse_A)) {
        await updateRecord(
          peopleObj.id,
          personRecordId,
          { location: JSON.stringify({ city: d.Ort_A || "", street: d.Strasse_A || "", postalCode: String(d.PLZ_A || "") }) },
          null
        );
      }

      // ── Build deal name ──
      const fromCity = d.Ort_BL || String(d.PLZ_BL || "");
      const toCity = d.Ort_EL || String(d.PLZ_EL || "");
      const leadTypeLabel = LEAD_TYPE_LABELS[d.LeadType] || d.LeadType || "Umzug";
      const moveDate = d.WunschterminVon || null;
      const dealName = computeLeadName({
        customerName: fullName,
        fromAddress: fromCity,
        toAddress: toCity,
        moveDate,
      });

      // ── Build inventory notes ──
      const inventoryParts: string[] = [];
      if (salutation) inventoryParts.push(`Anrede: ${salutation}`);
      if (d.LeadType) inventoryParts.push(`Typ: ${leadTypeLabel}`);
      if (d.Wohnflache_BL) inventoryParts.push(`Wohnfläche: ${d.Wohnflache_BL} m²`);
      if (d.Zimmer_BL) inventoryParts.push(`Zimmer: ${d.Zimmer_BL}`);
      if (d.Personen_BL) inventoryParts.push(`Personen: ${d.Personen_BL}`);
      if (d.UGLVolumen) inventoryParts.push(`UGL-Volumen: ${d.UGLVolumen} m³`);
      if (d.Distance) inventoryParts.push(`Entfernung: ${d.Distance} km`);
      if (d.Etage_BL) inventoryParts.push(`Etage Beladung: ${d.Etage_BL}`);
      if (d.Etage_EL) inventoryParts.push(`Etage Entladung: ${d.Etage_EL}`);
      if (d.Aufzug_BL) inventoryParts.push(`Aufzug Beladung: Ja`);
      if (d.Aufzug_EL) inventoryParts.push(`Aufzug Entladung: Ja`);
      if (d.Keller_BL) inventoryParts.push(`Keller: Ja`);
      if (d.Dachboden_BL) inventoryParts.push(`Dachboden: Ja`);

      // Services
      const services: string[] = [];
      if (d.Einpacken) services.push("Einpacken");
      if (d.Auspacken) services.push("Auspacken");
      if (d.Moebelmontage_BL) services.push("Möbelmontage (Beladung)");
      if (d.Moebelmontage_EL) services.push("Möbelmontage (Entladung)");
      if (d.Moebeldemontage) services.push("Möbeldemontage");
      if (d.Moebelremontage) services.push("Möbelremontage");
      if (d.Kuechenmontage_BL) services.push("Küchenmontage (Beladung)");
      if (d.Kuechenmontage_EL) services.push("Küchenmontage (Entladung)");
      if (d.KartonsEinpacken) services.push("Kartons einpacken");
      if (d.KartonsAuspacken) services.push("Kartons auspacken");
      if (d.Elektroarbeiten) services.push("Elektroarbeiten");
      if (d.MoebleEinlagern) services.push("Möbel einlagern");
      if (d.Entsorgung_BL) services.push("Entsorgung");
      if (services.length > 0) inventoryParts.push(`Services: ${services.join(", ")}`);

      if (d.Bemerkung_A) inventoryParts.push(`Bemerkung Kunde: ${d.Bemerkung_A}`);
      if (d.Bemerkung_BL) inventoryParts.push(`Bemerkung Beladung: ${d.Bemerkung_BL}`);
      if (d.Bemerkung_EL) inventoryParts.push(`Bemerkung Entladung: ${d.Bemerkung_EL}`);
      if (d.Freitext_UGL) inventoryParts.push(`Umzugsgut: ${d.Freitext_UGL}`);
      if (d.Foto_UGL_Kommentar) inventoryParts.push(`Foto-Kommentar: ${d.Foto_UGL_Kommentar}`);

      // Addresses
      const fromAddr = [d.Strasse_BL, `${d.PLZ_BL} ${d.Ort_BL}`].filter(Boolean).join(", ");
      const toAddr = [d.Strasse_EL, `${d.PLZ_EL} ${d.Ort_EL}`].filter(Boolean).join(", ");
      if (fromAddr) inventoryParts.push(`Von: ${fromAddr}`);
      if (toAddr) inventoryParts.push(`Nach: ${toAddr}`);

      // ── Build moving_lead_payload (full structured data) ──
      const payload: Record<string, unknown> = {
        externalId: aid,
        importId: d.ImportId,
        source: "immoscout24",
        channel: "api",
        leadType: d.LeadType,
        premiumLead: d.PremiumLead,
        createdAt: d.CreatedAt,
        client: {
          salutation: SALUTATION_MAP[d.Anrede_A],
          firstName: d.Vorname_A,
          lastName: d.Name_A,
          street: d.Strasse_A,
          zip: String(d.PLZ_A),
          city: d.Ort_A,
          phone: d.Telefon_A,
          phone2: d.Telefon2_A,
          email: d.Mail_A,
          comment: d.Bemerkung_A,
        },
        from: {
          street: d.Strasse_BL,
          zip: String(d.PLZ_BL),
          city: d.Ort_BL,
          floor: d.Etage_BL,
          livingSpace: d.Wohnflache_BL,
          elevator: d.Aufzug_BL,
          rooms: d.Zimmer_BL,
          persons: d.Personen_BL,
          basement: d.Keller_BL,
          attic: d.Dachboden_BL,
          comment: d.Bemerkung_BL,
        },
        to: {
          street: d.Strasse_EL,
          zip: String(d.PLZ_EL),
          city: d.Ort_EL,
          floor: d.Etage_EL,
          livingSpace: d.Wohnflache_EL,
          elevator: d.Aufzug_EL,
          persons: d.Personen_EL,
          basement: d.Keller_EL,
          attic: d.Dachboden_EL,
          comment: d.Bemerkung_EL,
        },
        dates: {
          desiredFrom: d.WunschterminVon,
          desiredTo: d.WunschterminBis,
          alternativeDate: d.Alternativtermin,
        },
        services: {
          packing: d.Einpacken,
          unpacking: d.Auspacken,
          furnitureAssemblyLoading: d.Moebelmontage_BL,
          furnitureAssemblyUnloading: d.Moebelmontage_EL,
          furnitureDismantling: d.Moebeldemontage,
          furnitureReassembly: d.Moebelremontage,
          kitchenLoading: d.Kuechenmontage_BL,
          kitchenUnloading: d.Kuechenmontage_EL,
          boxPacking: d.KartonsEinpacken,
          boxUnpacking: d.KartonsAuspacken,
          electricalWork: d.Elektroarbeiten,
          storage: d.MoebleEinlagern,
          disposal: d.Entsorgung_BL,
          viewingAppointment: d.Besichtigungstermin,
        },
        ugl: {
          available: d.UGLVorhanden,
          volume: d.UGLVolumen,
          freeText: d.Freitext_UGL,
          photoComment: d.Foto_UGL_Kommentar,
          photos: d.Foto_UGL,
          data: d.Ugl,
        },
        distance: d.Distance,
        payment: d.Zahlungsart || d.BezahltVon,
        importedAt: new Date().toISOString(),
      };

      // ── Create Deal ──
      const dealInput: Record<string, unknown> = {
        name: dealName,
        moving_lead_payload: payload,
      };
      if (moveDate) dealInput.move_date = moveDate;
      if (inventoryParts.length > 0) dealInput.inventory_notes = inventoryParts.join("\n");
      if (personRecordId) dealInput.associated_people = personRecordId;

      const dealRecord = await createRecord(dealsObj.id, dealInput, null);
      if (dealRecord) {
        await assignDealNumber(workspaceId, dealRecord.id);
      }

      // Mark as imported on umzug-easy side
      await markAsImported(apiKey, aid);

      existingExternalIds.add(aid);
      result.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Lead ${aid}: ${msg}`);
    }
  }

  return result;
}

// ─── Cross-channel helpers (shared with the IS24 email ingest) ───────

/**
 * Returns the existing deal record id whose moving_lead_payload.externalId
 * equals the given IS24 request id, or null. Both the umzug-easy API sync and
 * the IS24 email ingest call this so the same lead never becomes two deals
 * (the API `aid`/`ImportId` and the IS24 email request id are the SAME id).
 */
export async function findExistingMovingLeadDeal(
  workspaceId: string,
  externalId: string
): Promise<string | null> {
  const [dealsObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealsObj) return null;
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "moving_lead_payload")))
    .limit(1);
  if (!attr) return null;
  const [row] = await db
    .select({ recordId: recordValues.recordId })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(
      and(
        eq(records.objectId, dealsObj.id),
        eq(recordValues.attributeId, attr.id),
        sql`${recordValues.jsonValue}->>'externalId' = ${externalId}`
      )
    )
    .limit(1);
  return row?.recordId ?? null;
}

/**
 * Enrich an already-created deal with the structured moving-lead data. Used by
 * the IS24 email ingest, which creates the deal via createDealForNewConversation
 * (person + stage + conversation link) and then calls this so the deal matches a
 * umzug-easy API import (payload + inventory notes + move date + deal number).
 */
export async function setDealMovingLead(params: {
  workspaceId: string;
  dealRecordId: string;
  payload: Record<string, unknown>;
  inventoryNotes?: string;
  moveDate?: string | null;
}): Promise<void> {
  const [dealsObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, params.workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealsObj) return;
  const fields: Record<string, unknown> = { moving_lead_payload: params.payload };
  if (params.inventoryNotes) fields.inventory_notes = params.inventoryNotes;
  if (params.moveDate) fields.move_date = params.moveDate;
  await updateRecord(dealsObj.id, params.dealRecordId, fields, null);
  await assignDealNumber(params.workspaceId, params.dealRecordId);
}

// ─── Cron entrypoint ─────────────────────────────────────────────────

export interface GlobalSyncEntry {
  workspaceId: string;
  result?: SyncResult;
  error?: string;
}

/**
 * Run the umzug-easy lead import for every workspace whose ImmobilienScout24
 * integration is active and has an API key, persisting the run status on the
 * integration (lastSyncAt + lastSyncResult). Failures are isolated per
 * workspace so one bad token never blocks the others. Called by the
 * /api/cron/immoscout-sync route.
 */
export async function syncImmoscoutLeadsGlobal(): Promise<GlobalSyncEntry[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.slug, "immobilienscout24"),
        eq(integrations.status, "active")
      )
    );

  const out: GlobalSyncEntry[] = [];
  for (const immo of rows) {
    if (!immo.apiKey) continue;
    try {
      const result = await syncImmoscoutLeads(immo.workspaceId, immo.apiKey);
      await updateIntegration(immo.workspaceId, immo.id, {
        lastSyncAt: new Date(),
        lastSyncResult: JSON.stringify({
          source: "cron",
          total: result.total,
          created: result.created,
          skipped: result.skipped,
          errors: result.errors,
          at: new Date().toISOString(),
        }),
      });
      out.push({ workspaceId: immo.workspaceId, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[immoscout-sync] workspace ${immo.workspaceId} failed:`, msg);
      await updateIntegration(immo.workspaceId, immo.id, {
        lastSyncAt: new Date(),
        lastSyncResult: JSON.stringify({ source: "cron", error: msg, at: new Date().toISOString() }),
      }).catch(() => {});
      out.push({ workspaceId: immo.workspaceId, error: msg });
    }
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const LEAD_TYPE_LABELS: Record<string, string> = {
  umzug: "Umzug",
  fmz: "Fernumzug",
  klavier: "Klaviertransport",
  lager: "Einlagerung",
  beiladung: "Beiladung",
  entruempelung: "Entrümpelung",
};

async function findExistingPerson(
  peopleObjectId: string,
  email: string,
  phone: string,
  attrBySlug: Map<string, string>
): Promise<string | null> {
  // Try email first
  if (email) {
    const emailAttrId = attrBySlug.get("email_addresses");
    if (emailAttrId) {
      const [match] = await db
        .select({ recordId: recordValues.recordId })
        .from(recordValues)
        .innerJoin(records, eq(records.id, recordValues.recordId))
        .where(
          and(
            eq(records.objectId, peopleObjectId),
            eq(recordValues.attributeId, emailAttrId),
            eq(recordValues.textValue, email)
          )
        )
        .limit(1);
      if (match) return match.recordId;
    }
  }

  // Fallback to phone
  if (phone) {
    const phoneAttrId = attrBySlug.get("phone_numbers");
    if (phoneAttrId) {
      const [match] = await db
        .select({ recordId: recordValues.recordId })
        .from(recordValues)
        .innerJoin(records, eq(records.id, recordValues.recordId))
        .where(
          and(
            eq(records.objectId, peopleObjectId),
            eq(recordValues.attributeId, phoneAttrId),
            eq(recordValues.textValue, phone)
          )
        )
        .limit(1);
      if (match) return match.recordId;
    }
  }

  return null;
}
