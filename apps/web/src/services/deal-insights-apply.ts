/**
 * Write-back layer for AI-extracted deal insights.
 *
 * Supports selective application: the caller specifies which fields,
 * stage change, and activity note to actually persist. This enables
 * the "review → approve → apply" flow in the UI.
 *
 * Activity events are attributed to "User + KI" via the actorId +
 * a payload flag, so the timeline shows human-confirmed AI actions.
 */

import { db } from "@/db";
import { objects, attributes, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { eq, and, asc } from "drizzle-orm";
import { createRecord, getRecord, updateRecord } from "./records";
import { emitEvent } from "./activity-events";
import { DEFAULT_AUFTRAG_CHECKLIST } from "@openclaw-crm/shared";
import { extractPersonalName } from "@/lib/display-name";
import type { DealInsights } from "./deal-insights";

export interface ApplyInsightsInput {
  workspaceId: string;
  dealRecordId: string;
  insights: DealInsights;
  appliedBy: string | null;
  /** Which extracted data fields to apply. Empty = skip data fields. */
  selectedFields?: string[];
  /** Whether to apply the AI-suggested stage change. */
  applyStage?: boolean;
  /** Whether to post the activity_note to the activity log. */
  applyNote?: boolean;
  /** Whether to also propagate contact-info changes to the linked person record. */
  applyContact?: boolean;
  /** Whether to populate / upsert the linked Auftrag with the extracted fields. */
  applyAuftrag?: boolean;
}

export interface ApplyInsightsResult {
  fieldsUpdated: string[];
  stageUpdated: boolean;
  notePosted: boolean;
  contactUpdated: string[];
  auftragUpdated: string[];
  auftragRecordId: string | null;
}

/** Map of extracted field key → deal attribute slug (deal-level attributes only) */
const DEAL_FIELD_TO_SLUG: Record<string, { slug: string; label: string }> = {
  inventory_notes: { slug: "inventory_notes", label: "Inventar" },
  move_date: { slug: "move_date", label: "Umzugsdatum" },
  estimated_value_eur: { slug: "value", label: "Angebotswert" },
  move_from_address: { slug: "move_from_address", label: "Abholadresse" },
  move_to_address: { slug: "move_to_address", label: "Zieladresse" },
  floors_from: { slug: "floors_from", label: "Stockwerk Abholung" },
  floors_to: { slug: "floors_to", label: "Stockwerk Ziel" },
  elevator_from: { slug: "elevator_from", label: "Zugang Abholung" },
  elevator_to: { slug: "elevator_to", label: "Zugang Ziel" },
};

/** Extracted-field keys that map to attributes on the Auftrag (not the deal). */
const AUFTRAG_FIELD_KEYS: string[] = [
  "volume_cbm",
  "boxes_needed",
  "dismantling_required",
  "packing_service",
  "piano_transport",
  "disposal_required",
  "storage_required",
  "parking_halteverbot_needed",
  "time_window_start",
  "time_window_end",
  "special_requests",
  "payment_method",
];

const AUFTRAG_FIELD_LABELS: Record<string, string> = {
  volume_cbm: "Volumen (m³)",
  boxes_needed: "Kartons benötigt",
  dismantling_required: "Demontage",
  packing_service: "Einpackservice",
  piano_transport: "Klaviertransport",
  disposal_required: "Sperrmüll",
  storage_required: "Einlagerung",
  parking_halteverbot_needed: "Halteverbot",
  time_window_start: "Start (geplant)",
  time_window_end: "Ende (geplant)",
  special_requests: "Sonderwünsche",
  payment_method: "Zahlungsart",
};

/** Build a German address string from a freeform LLM address string into a minimal location object. */
function addressStringToLocationValue(text: string): Record<string, unknown> {
  // Keep it simple: store the raw text in line1; the LLM's format is already "Straße Nr, PLZ Ort".
  // Downstream location editors read line1/city/postcode but any shape is acceptable.
  return { line1: text.trim() };
}

/** Resolve a select option's ID from its title (case-insensitive). */
async function resolveSelectOptionId(
  attributeId: string,
  title: string
): Promise<string | null> {
  const { selectOptions } = await import("@/db/schema/objects");
  const rows = await db
    .select({ id: selectOptions.id, title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.attributeId, attributeId));
  const match = rows.find((r) => r.title.toLowerCase() === title.toLowerCase());
  return match?.id ?? null;
}

/**
 * Apply user-approved insights to a deal record.
 */
export async function applyDealInsights(
  params: ApplyInsightsInput
): Promise<ApplyInsightsResult> {
  const {
    workspaceId,
    dealRecordId,
    insights,
    appliedBy,
    selectedFields = [...Object.keys(DEAL_FIELD_TO_SLUG), ...AUFTRAG_FIELD_KEYS],
    applyStage = false,
    applyNote = true,
    applyContact = true,
    applyAuftrag = true,
  } = params;

  const result: ApplyInsightsResult = {
    fieldsUpdated: [],
    stageUpdated: false,
    notePosted: false,
    contactUpdated: [],
    auftragUpdated: [],
    auftragRecordId: null,
  };

  try {
    // 1. Resolve the deals object ID.
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
      .limit(1);

    if (!dealObj) {
      console.warn(`[deal-insights-apply] no deals object for workspace ${workspaceId}`);
      return result;
    }

    const input: Record<string, unknown> = {};
    const ext = insights.extracted;
    const selected = new Set(selectedFields);

    // 2. Apply selected deal-level fields.
    const addSimple = (key: keyof typeof ext, slug: string, label: string, raw: unknown) => {
      if (raw == null || raw === "") return;
      input[slug] = raw;
      result.fieldsUpdated.push(label);
      void key;
    };

    if (selected.has("inventory_notes")) addSimple("inventory_notes", "inventory_notes", "Inventar", ext.inventory_notes);
    if (selected.has("move_date")) addSimple("move_date", "move_date", "Umzugsdatum", ext.move_date);
    if (selected.has("estimated_value_eur") && ext.estimated_value_eur != null) {
      input.value = ext.estimated_value_eur;
      result.fieldsUpdated.push("Angebotswert");
    }
    if (selected.has("move_from_address") && ext.move_from_address) {
      input.move_from_address = addressStringToLocationValue(ext.move_from_address);
      result.fieldsUpdated.push("Abholadresse");
    }
    if (selected.has("move_to_address") && ext.move_to_address) {
      input.move_to_address = addressStringToLocationValue(ext.move_to_address);
      result.fieldsUpdated.push("Zieladresse");
    }
    if (selected.has("floors_from") && ext.floors_from != null) {
      input.floors_from = ext.floors_from;
      result.fieldsUpdated.push("Stockwerk Abholung");
    }
    if (selected.has("floors_to") && ext.floors_to != null) {
      input.floors_to = ext.floors_to;
      result.fieldsUpdated.push("Stockwerk Ziel");
    }

    // Elevator select — resolve option ID by title, because select attributes store the option ID.
    if (selected.has("elevator_from") && ext.elevator_from) {
      const [attr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "elevator_from")))
        .limit(1);
      if (attr) {
        const optId = await resolveSelectOptionId(attr.id, ext.elevator_from);
        if (optId) {
          input.elevator_from = optId;
          result.fieldsUpdated.push("Zugang Abholung");
        }
      }
    }
    if (selected.has("elevator_to") && ext.elevator_to) {
      const [attr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "elevator_to")))
        .limit(1);
      if (attr) {
        const optId = await resolveSelectOptionId(attr.id, ext.elevator_to);
        if (optId) {
          input.elevator_to = optId;
          result.fieldsUpdated.push("Zugang Ziel");
        }
      }
    }

    // 3. Contact-info propagation (deal name + linked person record).
    if (applyContact) {
      await applyContactUpdates({
        workspaceId,
        dealObjId: dealObj.id,
        dealRecordId,
        ext,
        appliedBy,
        dealInput: input,
        contactFieldsUpdated: result.contactUpdated,
      });
    }

    // 4. Stage change if approved.
    if (applyStage && insights.suggested_stage) {
      const [stageAttr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
        .limit(1);

      if (stageAttr) {
        const stageRows = await db
          .select({ id: statuses.id, title: statuses.title })
          .from(statuses)
          .where(eq(statuses.attributeId, stageAttr.id))
          .orderBy(asc(statuses.sortOrder));

        const matched = stageRows.find(
          (s) => s.title.toLowerCase() === insights.suggested_stage!.toLowerCase()
        );
        if (matched) {
          input.stage = matched.id;
          result.stageUpdated = true;
          result.fieldsUpdated.push("Stage");
        }
      }
    }

    // 5. Write all approved deal-level changes.
    if (Object.keys(input).length > 0) {
      await updateRecord(dealObj.id, dealRecordId, input, appliedBy);
    }

    // 6. Upsert Auftrag for this deal and populate its fields.
    if (applyAuftrag) {
      const auftragId = await upsertAuftragForDeal({
        workspaceId,
        dealRecordId,
        ext,
        selected,
        appliedBy,
        updatedFields: result.auftragUpdated,
      });
      result.auftragRecordId = auftragId;
    }

    // 7. Activity note (attributed to "User + KI").
    if (applyNote) {
      const noteText = insights.activity_note || insights.summary;
      await emitEvent({
        workspaceId,
        recordId: dealRecordId,
        objectSlug: "deals",
        eventType: "ai.insights_extracted",
        payload: {
          note: noteText,
          summary: insights.summary,
          fieldsUpdated: result.fieldsUpdated,
          stageUpdated: result.stageUpdated,
          contactUpdated: result.contactUpdated,
          auftragUpdated: result.auftragUpdated,
          auftragRecordId: result.auftragRecordId,
          missingFields: insights.missingFields,
          criticalMissing: insights.criticalMissing,
          openCustomerQuestions: insights.openCustomerQuestions,
          legalFlags: insights.legalFlags,
          confirmedByUser: !!appliedBy,
        },
        actorId: appliedBy,
      });
      result.notePosted = true;
    }
  } catch (err) {
    console.error("[deal-insights-apply] applyDealInsights failed:", err);
  }

  return result;
}

// ─── Contact propagation ────────────────────────────────────────────────────

async function applyContactUpdates(params: {
  workspaceId: string;
  dealObjId: string;
  dealRecordId: string;
  ext: DealInsights["extracted"];
  appliedBy: string | null;
  dealInput: Record<string, unknown>;
  contactFieldsUpdated: string[];
}) {
  const { workspaceId, dealObjId, dealRecordId, ext, appliedBy, dealInput, contactFieldsUpdated } = params;

  if (!ext.customer_name && !ext.customer_phone && !ext.customer_email) return;

  // Load the deal record to find associated people.
  const deal = await getRecord(dealObjId, dealRecordId);
  if (!deal) return;

  const associated = (deal.values as Record<string, unknown>).associated_people;
  const peopleRefs = Array.isArray(associated) ? (associated as Array<{ id: string }>) : [];
  const primaryPersonId = peopleRefs[0]?.id ?? null;

  // Resolve people object + attributes.
  const [peopleObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return;

  const personAttrs = await db
    .select()
    .from(attributes)
    .where(eq(attributes.objectId, peopleObj.id));
  const personAttrBySlug = new Map(personAttrs.map((a) => [a.slug, a]));

  // Current deal title (if name attribute exists on the deal).
  const dealCurrentName = typeof (deal.values as Record<string, unknown>).name === "string"
    ? ((deal.values as Record<string, unknown>).name as string)
    : "";

  if (primaryPersonId) {
    // Load existing person values.
    const person = await getRecord(peopleObj.id, primaryPersonId);
    if (!person) return;
    const pv = person.values as Record<string, unknown>;

    const personInput: Record<string, unknown> = {};

    // ── Name ────────────────────────────────────────────────────────
    if (ext.customer_name) {
      const nameAttr = personAttrBySlug.get("name");
      const current = nameAttr?.type === "personal_name"
        ? extractPersonalName(pv.name) || ""
        : (typeof pv.name === "string" ? pv.name : "");

      if (current.trim().toLowerCase() !== ext.customer_name.trim().toLowerCase()) {
        if (nameAttr?.type === "personal_name") {
          const parts = ext.customer_name.trim().split(/\s+/);
          const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
          const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
          personInput.name = { firstName, lastName, fullName: ext.customer_name.trim() };
        } else {
          personInput.name = ext.customer_name.trim();
        }
        contactFieldsUpdated.push(`Name: "${current || "(leer)"}" → "${ext.customer_name.trim()}"`);

        // If deal title equals the old person alias, update it too so the card/list shows the real name.
        if (dealCurrentName && dealCurrentName.trim().toLowerCase() === current.trim().toLowerCase()) {
          dealInput.name = ext.customer_name.trim();
        }
      }
    }

    // ── Phone ───────────────────────────────────────────────────────
    if (ext.customer_phone) {
      const existing = Array.isArray(pv.phone_numbers) ? (pv.phone_numbers as string[]) : [];
      const normalized = ext.customer_phone.replace(/\s+/g, "");
      const already = existing.some((p) => String(p).replace(/\s+/g, "") === normalized);
      if (!already) {
        personInput.phone_numbers = [...existing, ext.customer_phone.trim()];
        contactFieldsUpdated.push(`Telefon: +${ext.customer_phone.trim()}`);
      }
    }

    // ── Email ───────────────────────────────────────────────────────
    if (ext.customer_email && !ext.customer_email.endsWith("mail.kleinanzeigen.de")) {
      const existing = Array.isArray(pv.email_addresses) ? (pv.email_addresses as string[]) : [];
      const already = existing.some((e) => String(e).toLowerCase() === ext.customer_email!.toLowerCase());
      if (!already) {
        personInput.email_addresses = [...existing, ext.customer_email.trim()];
        contactFieldsUpdated.push(`E-Mail: +${ext.customer_email.trim()}`);
      }
    }

    if (Object.keys(personInput).length > 0) {
      await updateRecord(peopleObj.id, primaryPersonId, personInput, appliedBy);
    }
  } else if (ext.customer_name) {
    // No linked person yet — create one and link to deal.
    const nameAttr = personAttrBySlug.get("name");
    const personInput: Record<string, unknown> = {};
    if (nameAttr?.type === "personal_name") {
      const parts = ext.customer_name.trim().split(/\s+/);
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
      const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
      personInput.name = { firstName, lastName, fullName: ext.customer_name.trim() };
    } else {
      personInput.name = ext.customer_name.trim();
    }
    if (ext.customer_phone) personInput.phone_numbers = [ext.customer_phone.trim()];
    if (ext.customer_email && !ext.customer_email.endsWith("mail.kleinanzeigen.de")) {
      personInput.email_addresses = [ext.customer_email.trim()];
    }

    const created = await createRecord(peopleObj.id, personInput, appliedBy);
    if (created) {
      dealInput.associated_people = [created.id];
      contactFieldsUpdated.push(`Neue Person angelegt: ${ext.customer_name.trim()}`);
    }
  }
}

// ─── Auftrag upsert ─────────────────────────────────────────────────────────

async function upsertAuftragForDeal(params: {
  workspaceId: string;
  dealRecordId: string;
  ext: DealInsights["extracted"];
  selected: Set<string>;
  appliedBy: string | null;
  updatedFields: string[];
}): Promise<string | null> {
  const { workspaceId, dealRecordId, ext, selected, appliedBy, updatedFields } = params;

  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);
  if (!auftragObj) {
    // Not yet synced — skip gracefully.
    return null;
  }

  const auftragAttrs = await db
    .select()
    .from(attributes)
    .where(eq(attributes.objectId, auftragObj.id));
  const auftragAttrBySlug = new Map(auftragAttrs.map((a) => [a.slug, a]));

  // Find existing Auftrag linked to this deal via the `deal` record_reference attribute.
  const dealRefAttr = auftragAttrBySlug.get("deal");
  let auftragRecordId: string | null = null;
  if (dealRefAttr) {
    const refRows = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, auftragObj.id),
          eq(recordValues.attributeId, dealRefAttr.id),
          eq(recordValues.referencedRecordId, dealRecordId)
        )
      )
      .limit(1);
    auftragRecordId = refRows[0]?.recordId ?? null;
  }

  // Build input — only write fields that are (a) selected and (b) non-null in extraction.
  const input: Record<string, unknown> = {};

  const setIfSelected = (key: string, slug: string, raw: unknown) => {
    if (!selected.has(key)) return;
    if (raw == null || raw === "") return;
    input[slug] = raw;
    updatedFields.push(AUFTRAG_FIELD_LABELS[key] ?? slug);
  };

  setIfSelected("volume_cbm", "volume_cbm", ext.volume_cbm);
  setIfSelected("boxes_needed", "boxes_needed", ext.boxes_needed);
  setIfSelected("dismantling_required", "dismantling_required", ext.dismantling_required);
  setIfSelected("packing_service", "packing_service", ext.packing_service);
  setIfSelected("piano_transport", "piano_transport", ext.piano_transport);
  setIfSelected("disposal_required", "disposal_required", ext.disposal_required);
  setIfSelected("storage_required", "storage_required", ext.storage_required);
  setIfSelected("parking_halteverbot_needed", "parking_halteverbot_needed", ext.parking_halteverbot_needed);
  setIfSelected("time_window_start", "time_window_start", ext.time_window_start);
  setIfSelected("time_window_end", "time_window_end", ext.time_window_end);
  setIfSelected("special_requests", "special_requests", ext.special_requests);

  // payment_method → resolve select option ID
  if (selected.has("payment_method") && ext.payment_method) {
    const attr = auftragAttrBySlug.get("payment_method");
    if (attr) {
      const optId = await resolveSelectOptionId(attr.id, ext.payment_method);
      if (optId) {
        input.payment_method = optId;
        updatedFields.push("Zahlungsart");
      }
    }
  }

  if (!auftragRecordId) {
    // Create on demand, even if input is empty — user asked for an Auftrag on first analysis.
    // Copy operating_company from the deal + seed default checklist + link via `deal`.
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
      .limit(1);

    let auftragName = "Auftrag";
    let operatingCompanyId: string | null = null;

    if (dealObj) {
      const deal = await getRecord(dealObj.id, dealRecordId);
      if (deal) {
        const dealName = (deal.values as Record<string, unknown>).name;
        if (typeof dealName === "string" && dealName.trim()) auftragName = `Auftrag – ${dealName}`;
        const oc = (deal.values as Record<string, unknown>).operating_company;
        if (oc && typeof oc === "object" && "id" in oc) {
          operatingCompanyId = (oc as { id: string }).id;
        }
      }
    }

    const createInput: Record<string, unknown> = {
      name: auftragName,
      deal: dealRecordId,
      checklist: DEFAULT_AUFTRAG_CHECKLIST,
      ...input,
    };
    if (operatingCompanyId) createInput.operating_company = operatingCompanyId;

    const created = await createRecord(auftragObj.id, createInput, appliedBy);
    if (created) {
      updatedFields.push("Auftrag angelegt");
      return created.id;
    }
    return null;
  }

  if (Object.keys(input).length > 0) {
    await updateRecord(auftragObj.id, auftragRecordId, input, appliedBy);
  }
  return auftragRecordId;
}
