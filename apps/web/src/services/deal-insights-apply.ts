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
import { computeLeadName, shouldAutoRename } from "./lead-name";
import { canonicalizePhone, canonicalizeEmail, isRelayEmail } from "@/lib/identity/canonical";
import { findPersonsByCanonical, upsertIdentifier } from "./inbox-crm-link";
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
  /**
   * When true, only write a data field if its current value is empty — never
   * overwrite an existing (possibly human-corrected) value. Used by the nightly
   * cron so automation fills gaps without clobbering manual edits. The manual,
   * user-reviewed flow leaves this false (full overwrite of approved fields).
   * Stage moves and contact appends are unaffected.
   */
  onlyFillEmpty?: boolean;
}

export interface DealFieldChange {
  /** Attribute slug (e.g. "value", "stage"). */
  slug: string;
  /** German label shown in the timeline. */
  label: string;
  /** Pre-update value as a human-readable string. `null` = previously empty. */
  before: string | null;
  /** Post-update value as a human-readable string. */
  after: string | null;
}

export interface ApplyInsightsResult {
  fieldsUpdated: string[];
  /** Per-field before/after diffs for the deal record. Useful for audit / activity log. */
  changes: DealFieldChange[];
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
  "transporter",
  "worker_count",
  "equipment_needed",
  "walking_distance_from_m",
  "walking_distance_to_m",
  "contact_pickup_name",
  "contact_pickup_phone",
  "contact_dropoff_name",
  "contact_dropoff_phone",
  "amount_outstanding_eur",
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
  transporter: "Transporter",
  worker_count: "Anzahl Arbeiter",
  equipment_needed: "Werkzeug / Material",
  walking_distance_from_m: "Laufweg Abholung",
  walking_distance_to_m: "Laufweg Ziel",
  contact_pickup_name: "Kontakt Abholort",
  contact_pickup_phone: "Kontakt Abholort (Telefon)",
  contact_dropoff_name: "Kontakt Zielort",
  contact_dropoff_phone: "Kontakt Zielort (Telefon)",
  amount_outstanding_eur: "Offener Betrag",
};

/**
 * Coerce an LLM date to a valid ISO `YYYY-MM-DD`, or null if unparseable.
 * Accepts ISO and German `DD.MM.YYYY`. Returning null means the field is
 * skipped rather than crashing the whole batched updateRecord with an invalid
 * date (a Postgres `date` column rejects e.g. "15. Juni").
 */
function toSafeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? null : s;
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso;
  }
  return null;
}

/** Validate an LLM timestamp string; null if it would produce an Invalid Date. */
function toSafeTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  return isNaN(new Date(s).getTime()) ? null : s;
}

/**
 * Parse a freeform German address ("Straße Nr, PLZ Ort") into the canonical
 * location shape { line1, postcode, city }. Falls back to line1-only when the
 * format is not recognized, so downstream consumers (depot PLZ-auto-pick, CSV
 * export) get structured city/postcode when available.
 */
function addressStringToLocationValue(text: string): Record<string, unknown> {
  const raw = text.trim();
  const result: Record<string, unknown> = { line1: raw };
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    result.line1 = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const m = parts[i].match(/\b(\d{5})\b\s*(.*)/);
      if (m) {
        result.postcode = m[1];
        if (m[2]?.trim()) result.city = m[2].trim();
        break;
      }
    }
    if (!result.postcode && !result.city) result.city = parts[1];
  }
  return result;
}

/**
 * Render any deal-attribute value as a short human-readable string, used in
 * the activity-log diff (e.g. "Neue Anfrage", "25", "—"). Resolves status /
 * select option IDs back to their titles. Returns "—" for null / empty.
 */
async function formatChangeValue(
  dealObjId: string,
  slug: string,
  value: unknown
): Promise<string | null> {
  if (value == null || value === "") return null;
  if (slug === "stage") {
    const id = typeof value === "string" ? value : null;
    if (!id) return String(value);
    const [row] = await db
      .select({ title: statuses.title })
      .from(statuses)
      .where(eq(statuses.id, id))
      .limit(1);
    return row?.title ?? id;
  }
  if (slug === "elevator_from" || slug === "elevator_to") {
    const id = typeof value === "string" ? value : null;
    if (!id) return String(value);
    const { selectOptions } = await import("@/db/schema/objects");
    const [row] = await db
      .select({ title: selectOptions.title })
      .from(selectOptions)
      .where(eq(selectOptions.id, id))
      .limit(1);
    return row?.title ?? id;
  }
  if (typeof value === "object") {
    // Locations stored as { line1, ... } — show line1, else compact JSON.
    const obj = value as Record<string, unknown>;
    if (typeof obj.line1 === "string" && obj.line1.trim()) return obj.line1.trim();
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Normalize a pipeline-stage title for forgiving matching: lowercase, trimmed,
 * and with any trailing parenthetical dropped, so the model's "Bezahlt" still
 * matches the DB status "Bezahlt (Abgeschlossen)".
 */
function normalizeStageTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
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
    onlyFillEmpty = false,
  } = params;

  const result: ApplyInsightsResult = {
    fieldsUpdated: [],
    changes: [],
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

    // Snapshot the deal BEFORE any writes so we can compute per-field diffs
    // for the activity-log audit trail. Stage labels and select option titles
    // are resolved lazily below (only for fields that actually changed).
    const dealSnapshot = await getRecord(dealObj.id, dealRecordId);
    const beforeValues = (dealSnapshot?.values ?? {}) as Record<string, unknown>;
    const labelByDealSlug: Record<string, string> = {
      ...Object.fromEntries(Object.values(DEAL_FIELD_TO_SLUG).map((v) => [v.slug, v.label])),
      stage: "Stage",
      name: "Lead-Titel",
    };

    // onlyFillEmpty guard: in the automated (cron) path, never overwrite an
    // existing non-empty value — only fill gaps.
    const isEmptyValue = (v: unknown) =>
      v == null || v === "" || (Array.isArray(v) && v.length === 0);
    const canWriteDeal = (slug: string) =>
      !onlyFillEmpty || isEmptyValue(beforeValues[slug]);

    // 2. Apply selected deal-level fields.
    const addSimple = (key: keyof typeof ext, slug: string, label: string, raw: unknown) => {
      if (raw == null || raw === "") return;
      if (!canWriteDeal(slug)) return;
      input[slug] = raw;
      result.fieldsUpdated.push(label);
      void key;
    };

    if (selected.has("inventory_notes")) addSimple("inventory_notes", "inventory_notes", "Inventar", ext.inventory_notes);
    if (selected.has("move_date")) addSimple("move_date", "move_date", "Umzugsdatum", toSafeDate(ext.move_date));
    if (selected.has("estimated_value_eur") && ext.estimated_value_eur != null && canWriteDeal("value")) {
      // `value` is a currency attribute → json_value expects { amount, currencyCode }
      // (same shape as amount_outstanding below). Writing a bare number renders empty.
      input.value = { amount: ext.estimated_value_eur, currencyCode: "EUR" };
      result.fieldsUpdated.push("Angebotswert");
    }
    if (selected.has("move_from_address") && ext.move_from_address && canWriteDeal("move_from_address")) {
      input.move_from_address = addressStringToLocationValue(ext.move_from_address);
      result.fieldsUpdated.push("Abholadresse");
    }
    if (selected.has("move_to_address") && ext.move_to_address && canWriteDeal("move_to_address")) {
      input.move_to_address = addressStringToLocationValue(ext.move_to_address);
      result.fieldsUpdated.push("Zieladresse");
    }
    if (selected.has("floors_from") && ext.floors_from != null && canWriteDeal("floors_from")) {
      input.floors_from = ext.floors_from;
      result.fieldsUpdated.push("Stockwerk Abholung");
    }
    if (selected.has("floors_to") && ext.floors_to != null && canWriteDeal("floors_to")) {
      input.floors_to = ext.floors_to;
      result.fieldsUpdated.push("Stockwerk Ziel");
    }

    // Elevator select — resolve option ID by title, because select attributes store the option ID.
    if (selected.has("elevator_from") && ext.elevator_from && canWriteDeal("elevator_from")) {
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
    if (selected.has("elevator_to") && ext.elevator_to && canWriteDeal("elevator_to")) {
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

    // 4. Stage change if approved — forward-only.
    if (applyStage && insights.suggested_stage) {
      const [stageAttr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
        .limit(1);

      if (stageAttr) {
        const stageRows = await db
          .select({ id: statuses.id, title: statuses.title, sortOrder: statuses.sortOrder })
          .from(statuses)
          .where(eq(statuses.attributeId, stageAttr.id))
          .orderBy(asc(statuses.sortOrder));

        const wantStage = normalizeStageTitle(insights.suggested_stage!);
        const suggested =
          stageRows.find(
            (s) => s.title.toLowerCase() === insights.suggested_stage!.toLowerCase()
          ) ?? stageRows.find((s) => normalizeStageTitle(s.title) === wantStage);
        if (suggested) {
          // Forward-only: refuse to drag a deal backward in the pipeline.
          // A chat smalltalk after delivery must never re-open the deal as
          // "Neue Anfrage". Use sortOrder as the canonical order — same as
          // the kanban left-to-right reading.
          const currentStageId = beforeValues.stage as string | undefined;
          const current = currentStageId
            ? stageRows.find((s) => s.id === currentStageId)
            : null;
          const isForward =
            !current || suggested.sortOrder > current.sortOrder;
          if (isForward) {
            input.stage = suggested.id;
            result.stageUpdated = true;
            result.fieldsUpdated.push("Stage");
          } else {
            console.log(
              `[apply] Stage suggestion "${suggested.title}" rejected — would move backward from "${current?.title}"`
            );
          }
        }
      }
    }

    // 5a. Recompute Lead name if its current title is auto-generated and we
    //     now have a better (name, address, date) to build from.
    try {
      const currentName = beforeValues.name;
      const currentNameStr = typeof currentName === "string" ? currentName : null;
      if (shouldAutoRename(currentNameStr)) {
        const nextName = computeLeadName({
          customerName: ext.customer_name ?? currentNameStr ?? null,
          moveDate: ext.move_date ?? (beforeValues.move_date as string | null | undefined) ?? null,
          fromAddress:
            (input.move_from_address as unknown) ??
            (beforeValues.move_from_address as unknown) ??
            null,
          toAddress:
            (input.move_to_address as unknown) ??
            (beforeValues.move_to_address as unknown) ??
            null,
        });
        if (nextName && nextName !== currentNameStr) {
          input.name = nextName;
          result.fieldsUpdated.push("Lead-Titel");
        }
      }
    } catch (err) {
      console.warn("[deal-insights-apply] lead-name recompute failed:", err);
    }

    // 5b. Capture per-field diffs (before/after) for the activity log.
    //     Resolve stage option ID → stage title and select option IDs to titles
    //     for human-readable display. Run BEFORE updateRecord so `beforeValues`
    //     still reflects pre-update state.
    for (const slug of Object.keys(input)) {
      const label = labelByDealSlug[slug] ?? slug;
      const beforeRaw = beforeValues[slug];
      const afterRaw = input[slug];
      const [beforeStr, afterStr] = await Promise.all([
        formatChangeValue(dealObj.id, slug, beforeRaw),
        formatChangeValue(dealObj.id, slug, afterRaw),
      ]);
      if (beforeStr === afterStr) continue;
      result.changes.push({ slug, label, before: beforeStr, after: afterStr });
    }

    // Stamp last_insights_at so the n8n hot-loop knows this deal is fresh.
    // Inserted into the same write so we get one DB round-trip and one
    // updatedAt bump.
    input.last_insights_at = new Date().toISOString();

    // 5c. Write all approved deal-level changes.
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
        onlyFillEmpty,
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
          changes: result.changes,
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

  // Register the KI-extracted phone/email on the identity graph
  // (person_identifiers) so the KA/WhatsApp dedupe can see them. Guarded so we
  // never steal a hard key already owned by a DIFFERENT person — that cross-link
  // is the async matcher's job, not ours.
  const registerContactIdentifiers = async (personId: string) => {
    if (ext.customer_phone) {
      const canon = canonicalizePhone(ext.customer_phone);
      if (canon) {
        const owners = await findPersonsByCanonical(workspaceId, [canon], null);
        if (owners.length === 0 || owners.includes(personId)) {
          await upsertIdentifier(workspaceId, personId, "phone", ext.customer_phone.trim(), canon, "operator", "claimed");
        }
      }
    }
    if (ext.customer_email && !isRelayEmail(ext.customer_email)) {
      const canon = canonicalizeEmail(ext.customer_email);
      if (canon) {
        const owners = await findPersonsByCanonical(workspaceId, [], canon);
        if (owners.length === 0 || owners.includes(personId)) {
          await upsertIdentifier(workspaceId, personId, "email", ext.customer_email.trim(), canon, "operator", "claimed");
        }
      }
    }
  };

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
    await registerContactIdentifiers(primaryPersonId);
  } else {
    // No linked person yet. First dedupe against the identity graph by HARD key
    // (canonical phone / email) so we attach to the existing golden person
    // instead of manufacturing a duplicate every run.
    const phoneCanon = ext.customer_phone ? canonicalizePhone(ext.customer_phone) : null;
    const emailCanon =
      ext.customer_email && !isRelayEmail(ext.customer_email)
        ? canonicalizeEmail(ext.customer_email)
        : null;
    let targetPersonId: string | null = null;
    if (phoneCanon || emailCanon) {
      const matches = await findPersonsByCanonical(
        workspaceId,
        phoneCanon ? [phoneCanon] : [],
        emailCanon
      );
      targetPersonId = matches[0] ?? null;
    }

    if (targetPersonId) {
      // Attach the existing person to the deal and enrich its arrays.
      dealInput.associated_people = [targetPersonId];
      const person = await getRecord(peopleObj.id, targetPersonId);
      const pv = (person?.values ?? {}) as Record<string, unknown>;
      const enrich: Record<string, unknown> = {};
      if (ext.customer_phone) {
        const existing = Array.isArray(pv.phone_numbers) ? (pv.phone_numbers as string[]) : [];
        const norm = ext.customer_phone.replace(/\s+/g, "");
        if (!existing.some((p) => String(p).replace(/\s+/g, "") === norm)) {
          enrich.phone_numbers = [...existing, ext.customer_phone.trim()];
        }
      }
      if (emailCanon && ext.customer_email) {
        const existing = Array.isArray(pv.email_addresses) ? (pv.email_addresses as string[]) : [];
        if (!existing.some((e) => String(e).toLowerCase() === ext.customer_email!.toLowerCase())) {
          enrich.email_addresses = [...existing, ext.customer_email.trim()];
        }
      }
      if (Object.keys(enrich).length > 0) {
        await updateRecord(peopleObj.id, targetPersonId, enrich, appliedBy);
      }
      contactFieldsUpdated.push(`Bestehende Person verknüpft`);
      await registerContactIdentifiers(targetPersonId);
    } else if (ext.customer_name) {
      // No match — create a new person and link it to the deal.
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
      if (emailCanon && ext.customer_email) {
        personInput.email_addresses = [ext.customer_email.trim()];
      }

      const created = await createRecord(peopleObj.id, personInput, appliedBy);
      if (created) {
        dealInput.associated_people = [created.id];
        contactFieldsUpdated.push(`Neue Person angelegt: ${ext.customer_name.trim()}`);
        await registerContactIdentifiers(created.id);
      }
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
  onlyFillEmpty: boolean;
}): Promise<string | null> {
  const { workspaceId, dealRecordId, ext, selected, appliedBy, updatedFields, onlyFillEmpty } = params;

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

  // Load existing Auftrag values so the onlyFillEmpty guard never overwrites a
  // value already on the job sheet (a new Auftrag has none, so all writes pass).
  let existingAuftrag: Record<string, unknown> = {};
  if (auftragRecordId) {
    const rec = await getRecord(auftragObj.id, auftragRecordId);
    existingAuftrag = (rec?.values ?? {}) as Record<string, unknown>;
  }
  const isEmptyAuftrag = (v: unknown) =>
    v == null || v === "" || (Array.isArray(v) && v.length === 0);
  const canWriteAuftrag = (slug: string) =>
    !onlyFillEmpty || isEmptyAuftrag(existingAuftrag[slug]);

  // Build input — only write fields that are (a) selected and (b) non-null in extraction.
  const input: Record<string, unknown> = {};

  const setIfSelected = (key: string, slug: string, raw: unknown) => {
    if (!selected.has(key)) return;
    if (raw == null || raw === "") return;
    if (!canWriteAuftrag(slug)) return;
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
  setIfSelected("time_window_start", "time_window_start", toSafeTimestamp(ext.time_window_start));
  setIfSelected("time_window_end", "time_window_end", toSafeTimestamp(ext.time_window_end));
  setIfSelected("special_requests", "special_requests", ext.special_requests);
  setIfSelected("worker_count", "worker_count", ext.worker_count);
  setIfSelected("walking_distance_from_m", "walking_distance_from_m", ext.walking_distance_from_m);
  setIfSelected("walking_distance_to_m", "walking_distance_to_m", ext.walking_distance_to_m);
  setIfSelected("contact_pickup_name", "contact_pickup_name", ext.contact_pickup_name);
  setIfSelected("contact_pickup_phone", "contact_pickup_phone", ext.contact_pickup_phone);
  setIfSelected("contact_dropoff_name", "contact_dropoff_name", ext.contact_dropoff_name);
  setIfSelected("contact_dropoff_phone", "contact_dropoff_phone", ext.contact_dropoff_phone);

  // amount_outstanding (currency) → needs { amount, currencyCode } shape
  if (selected.has("amount_outstanding_eur") && ext.amount_outstanding_eur != null && canWriteAuftrag("amount_outstanding")) {
    input.amount_outstanding = { amount: ext.amount_outstanding_eur, currencyCode: "EUR" };
    updatedFields.push("Offener Betrag");
  }

  // payment_method → resolve select option ID
  if (selected.has("payment_method") && ext.payment_method && canWriteAuftrag("payment_method")) {
    const attr = auftragAttrBySlug.get("payment_method");
    if (attr) {
      const optId = await resolveSelectOptionId(attr.id, ext.payment_method);
      if (optId) {
        input.payment_method = optId;
        updatedFields.push("Zahlungsart");
      }
    }
  }

  // transporter → resolve select option ID
  if (selected.has("transporter") && ext.transporter && canWriteAuftrag("transporter")) {
    const attr = auftragAttrBySlug.get("transporter");
    if (attr) {
      const optId = await resolveSelectOptionId(attr.id, ext.transporter);
      if (optId) {
        input.transporter = optId;
        updatedFields.push("Transporter");
      }
    }
  }

  // equipment_needed (multi-select) → resolve option IDs
  if (selected.has("equipment_needed") && Array.isArray(ext.equipment_needed) && ext.equipment_needed.length > 0 && canWriteAuftrag("equipment_needed")) {
    const attr = auftragAttrBySlug.get("equipment_needed");
    if (attr) {
      const ids: string[] = [];
      for (const title of ext.equipment_needed) {
        const optId = await resolveSelectOptionId(attr.id, title);
        if (optId) ids.push(optId);
      }
      if (ids.length > 0) {
        input.equipment_needed = ids;
        updatedFields.push("Werkzeug / Material");
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
