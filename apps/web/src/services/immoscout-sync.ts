/**
 * ImmobilienScout / umzug-easy lead sync.
 *
 * Fetches moving-request leads from the umzug-easy.de API and upserts
 * them into the CRM as People + Deal records. Deduplication is based
 * on the external lead ID stored in the deal's `moving_lead_payload.externalId`.
 */

import { db } from "@/db";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { eq, and } from "drizzle-orm";
import { createRecord } from "./records";
import { assignDealNumber } from "./financial";

const API_BASE = "https://www.umzug-easy.de/api";

// ─── Types ───────────────────────────────────────────────────────────

interface UmzugLeadSummary {
  id: number | string;
  [key: string]: unknown;
}

interface UmzugLeadDetail {
  id: number | string;
  // Contact info
  salutation?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  telephone?: string;
  // Moving details
  from_address?: string;
  from_zip?: string;
  from_city?: string;
  from_street?: string;
  from_floor?: string;
  to_address?: string;
  to_zip?: string;
  to_city?: string;
  to_street?: string;
  to_floor?: string;
  move_date?: string;
  moving_date?: string;
  date?: string;
  // Inventory / volume
  living_space?: string | number;
  area?: string | number;
  volume?: string | number;
  rooms?: string | number;
  persons?: string | number;
  // Additional
  notes?: string;
  comment?: string;
  message?: string;
  description?: string;
  created_at?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SyncResult {
  total: number;
  created: number;
  skipped: number;
  errors: string[];
}

// ─── API Helpers ─────────────────────────────────────────────────────

async function fetchLeadList(apiKey: string): Promise<UmzugLeadSummary[]> {
  const res = await fetch(`${API_BASE}/listrequests`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`umzug-easy /listrequests failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // API may return array directly or wrapped in a data/results key
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.requests)) return data.requests;
  return [];
}

async function fetchLeadDetail(apiKey: string, leadId: string | number): Promise<UmzugLeadDetail> {
  const res = await fetch(`${API_BASE}/request/${leadId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`umzug-easy /request/${leadId} failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // Unwrap if nested
  return data.data ?? data.request ?? data;
}

// ─── Sync Logic ──────────────────────────────────────────────────────

export async function syncImmoscoutLeads(
  workspaceId: string,
  apiKey: string
): Promise<SyncResult> {
  const result: SyncResult = { total: 0, created: 0, skipped: 0, errors: [] };

  // 1. Fetch lead list
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

  // 5. Collect existing external IDs to skip duplicates
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
  for (const leadSummary of leads) {
    const externalId = String(leadSummary.id);

    // Skip already-imported leads
    if (existingExternalIds.has(externalId)) {
      result.skipped++;
      continue;
    }

    try {
      const detail = await fetchLeadDetail(apiKey, leadSummary.id);

      // ── Create Person ──
      const firstName = detail.first_name || "";
      const lastName = detail.last_name || "";
      const fullName = detail.name || `${firstName} ${lastName}`.trim() || "Unbekannt";

      const phone = detail.phone || detail.mobile || detail.telephone || "";
      const email = detail.email || "";

      // Dedup: check if a person with this email or phone exists
      let personRecordId: string | null = null;
      personRecordId = await findExistingPerson(peopleObj.id, email, phone, peopleAttrBySlug);

      if (!personRecordId) {
        const personInput: Record<string, unknown> = {
          name: {
            first_name: firstName || fullName.split(" ")[0] || "",
            last_name: lastName || fullName.split(" ").slice(1).join(" ") || "",
            full_name: fullName,
          },
        };
        if (email) personInput.email_addresses = email;
        if (phone) personInput.phone_numbers = phone;
        if (leadSourceOptionId) personInput.lead_source = leadSourceOptionId;

        const personRecord = await createRecord(peopleObj.id, personInput, null);
        personRecordId = personRecord?.id ?? null;
      }

      // ── Build deal name ──
      const fromCity = detail.from_city || detail.from_zip || "";
      const toCity = detail.to_city || detail.to_zip || "";
      const dealName = fromCity && toCity
        ? `Umzug ${fromCity} → ${toCity} (${fullName})`
        : `Anfrage ${fullName}`;

      // ── Build moving_lead_payload ──
      const moveDate = detail.move_date || detail.moving_date || detail.date || null;
      const payload: Record<string, unknown> = {
        externalId,
        source: "umzug-easy",
        salutation: detail.salutation,
        from: {
          address: detail.from_address,
          zip: detail.from_zip,
          city: detail.from_city,
          street: detail.from_street,
          floor: detail.from_floor,
        },
        to: {
          address: detail.to_address,
          zip: detail.to_zip,
          city: detail.to_city,
          street: detail.to_street,
          floor: detail.to_floor,
        },
        moveDate,
        livingSpace: detail.living_space || detail.area,
        volume: detail.volume,
        rooms: detail.rooms,
        persons: detail.persons,
        notes: detail.notes || detail.comment || detail.message || detail.description,
        importedAt: new Date().toISOString(),
        rawPayload: detail,
      };

      // ── Build inventory notes from detail ──
      const inventoryParts: string[] = [];
      if (detail.living_space || detail.area)
        inventoryParts.push(`Fläche: ${detail.living_space || detail.area} m²`);
      if (detail.volume) inventoryParts.push(`Volumen: ${detail.volume} m³`);
      if (detail.rooms) inventoryParts.push(`Zimmer: ${detail.rooms}`);
      if (detail.persons) inventoryParts.push(`Personen: ${detail.persons}`);
      if (detail.notes || detail.comment || detail.message)
        inventoryParts.push(detail.notes || detail.comment || detail.message || "");

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

      existingExternalIds.add(externalId);
      result.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Lead ${externalId}: ${msg}`);
    }
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

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
