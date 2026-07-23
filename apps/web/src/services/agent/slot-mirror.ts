/**
 * Phase-1 SHADOW MODE qualification-slot mirror (docs/ai-sales-agent-plan.md).
 *
 * Mirrors the results of the existing KI-Analyse extraction pipeline
 * (services/deal-insights.ts → deal-insights-apply.ts) into the typed
 * `qualification_slots` table so slot coverage / accuracy can be measured
 * before the agent ever acts on it. READ-ONLY towards the rest of the CRM:
 *
 *   - never writes deal / Auftrag EAV values (only qualification_slots),
 *   - never throws top-level (log + partial counts),
 *   - never touches slot rows in status 'refused' / 'confirmed',
 *   - never downgrades 'filled' / 'confirmed' / 'refused' back to 'missing'.
 *
 * Source of truth per deal is the latest `ai.insights_extracted` activity
 * event (the durable insights cache written by deal-insights-apply). Its
 * payload does NOT carry the raw extracted values — it carries `changes`
 * (only fields that changed that run), `missingFields` (human-readable
 * German labels), `criticalMissing` ({ field, question } with insight-field
 * slugs) and `auftragRecordId`. The extracted VALUES were applied to the
 * deal / Auftrag EAV records by deal-insights-apply, so we read them back
 * from there — that reflects the full extraction state across runs, not
 * just the latest diff.
 */

import { db } from "@/db";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { activityEvents } from "@/db/schema";
import { qualificationSlots } from "@/db/schema/agent";
import { attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";

export type QualificationSlotKey =
  | "move_date"
  | "from_address"
  | "to_address"
  | "floor_from"
  | "floor_to"
  | "elevator_from"
  | "elevator_to"
  | "rooms_volume"
  | "special_items"
  | "packing_service"
  | "parking_halteverbot"
  | "followup_consent";

/**
 * Deal-level EAV slug → slot key. Slugs verified against DEAL_FIELD_TO_SLUG
 * in deal-insights-apply.ts (where the extraction is written to the deal).
 * `inventory_notes` is handled separately (folded into `special_items`).
 */
/** Safety valve for one mirror run: keyset pagination drains the whole window
 * but a tick never processes more than this many deals. */
const MAX_DEALS_PER_RUN = 500;

const DEAL_SLUG_TO_SLOT: Record<string, QualificationSlotKey> = {
  move_date: "move_date",
  move_from_address: "from_address",
  move_to_address: "to_address",
  floors_from: "floor_from",
  floors_to: "floor_to",
  elevator_from: "elevator_from",
  elevator_to: "elevator_to",
};

/**
 * Insight extraction-field key → slot key. Used for `criticalMissing[].field`
 * (which carries these slugs per the InsightsSchema description) and for
 * exact-key matches in `missingFields`. Keys verified against
 * ExtractedDealSchema in deal-insights.ts. Keys without a slot
 * (customer_phone, customer_email, …) are deliberately absent.
 */
const INSIGHT_KEY_TO_SLOT: Record<string, QualificationSlotKey> = {
  move_date: "move_date",
  move_from_address: "from_address",
  move_to_address: "to_address",
  floors_from: "floor_from",
  floors_to: "floor_to",
  elevator_from: "elevator_from",
  elevator_to: "elevator_to",
  volume_cbm: "rooms_volume",
  inventory_notes: "special_items",
  packing_service: "packing_service",
  parking_halteverbot_needed: "parking_halteverbot",
};

/** Empty means "we do not know". `false` is knowledge (e.g. no packing). */
function isEmptyValue(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * `missingFields` is a free-form German label list ("Umzugsdatum",
 * "Abholadresse", …) — see InsightsSchema. Conservative matcher: exact
 * insight-key match first, then unambiguous German keywords. Ambiguous
 * entries (e.g. bare "Etage" without from/to direction) are skipped —
 * criticalMissing carries the clean slugs anyway.
 */
function slotFromMissingEntry(raw: string): QualificationSlotKey | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const direct = INSIGHT_KEY_TO_SLOT[s];
  if (direct) return direct;
  const from = /(abhol|auszug|aktuell|start)/.test(s);
  const to = /(ziel|einzug)/.test(s);
  if (s.includes("halteverbot")) return "parking_halteverbot";
  if (s.includes("volumen") || s.includes("kubik") || s.includes("m³")) return "rooms_volume";
  if (s.includes("inventar")) return "special_items";
  if (s.includes("packservice") || s.includes("einpack")) return "packing_service";
  if (s.includes("datum") || s.includes("termin")) return "move_date";
  if (s.includes("adresse")) return from && !to ? "from_address" : to && !from ? "to_address" : null;
  if (s.includes("stockwerk") || s.includes("etage")) return from && !to ? "floor_from" : to && !from ? "floor_to" : null;
  if (s.includes("aufzug")) return from && !to ? "elevator_from" : to && !from ? "elevator_to" : null;
  return null;
}

export interface SlotMirrorSummary {
  /** Deals whose latest insights event was mirrored this run. */
  deals: number;
  /** Slot rows actually inserted or updated (guard-skipped rows not counted). */
  slotsWritten: number;
}

/**
 * Mirrors the latest KI-Analyse result of recently-analyzed deals into
 * `qualification_slots`. Shadow-mode only: no deal/Auftrag write, no send,
 * no engine coupling. Safe to re-run any time (idempotent upserts).
 */
export async function mirrorSlotsForRecentDeals(
  workspaceId: string,
  opts?: { sinceHours?: number; limit?: number }
): Promise<SlotMirrorSummary> {
  const summary: SlotMirrorSummary = { deals: 0, slotsWritten: 0 };
  try {
    const sinceHours = opts?.sinceHours ?? 24;
    const pageSize = opts?.limit ?? 50;
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    // Latest ai.insights_extracted event per deal within the window, drained
    // with KEYSET pagination on record_id: DISTINCT ON forces ORDER BY
    // record_id, so a bare LIMIT would deterministically starve the deals with
    // the highest UUIDs whenever >pageSize deals were analyzed in the window
    // (a single nightly bulk refresh does that). MAX_DEALS_PER_RUN caps a tick.
    const events: Array<{ recordId: string | null; payload: unknown }> = [];
    let lastRecordId: string | null = null;
    while (events.length < MAX_DEALS_PER_RUN) {
      const page = await db
        .selectDistinctOn([activityEvents.recordId], {
          recordId: activityEvents.recordId,
          payload: activityEvents.payload,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.workspaceId, workspaceId),
            eq(activityEvents.eventType, "ai.insights_extracted"),
            isNotNull(activityEvents.recordId),
            gt(activityEvents.createdAt, since),
            ...(lastRecordId ? [gt(activityEvents.recordId, lastRecordId)] : [])
          )
        )
        .orderBy(activityEvents.recordId, desc(activityEvents.createdAt))
        .limit(pageSize);
      if (page.length === 0) break;
      events.push(...page);
      lastRecordId = page[page.length - 1].recordId;
      if (page.length < pageSize || !lastRecordId) break;
    }
    if (events.length === 0) return summary;

    const dealObj = await getObjectBySlug(workspaceId, "deals");
    if (!dealObj) return summary;

    // Auftrag object + its `deal` record_reference attribute (for deals whose
    // event payload predates auftragRecordId or ran without applyAuftrag).
    const auftragObj = await getObjectBySlug(workspaceId, "auftraege");
    let auftragDealRefAttrId: string | null = null;
    if (auftragObj) {
      const [refAttr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, auftragObj.id), eq(attributes.slug, "deal")))
        .limit(1);
      auftragDealRefAttrId = refAttr?.id ?? null;
    }

    for (const ev of events) {
      if (!ev.recordId) continue;
      try {
        const written = await mirrorOneDeal({
          workspaceId,
          dealObjId: dealObj.id,
          dealRecordId: ev.recordId,
          payload: (ev.payload ?? {}) as Record<string, unknown>,
          auftragObjId: auftragObj?.id ?? null,
          auftragDealRefAttrId,
        });
        if (written < 0) continue; // deal record gone — not counted
        summary.deals += 1;
        summary.slotsWritten += written;
      } catch (err) {
        console.error(`[slot-mirror] deal ${ev.recordId} failed:`, err);
      }
    }
  } catch (err) {
    console.error("[slot-mirror] run failed:", err);
  }
  return summary;
}

/** Returns slot rows written, or -1 when the deal record no longer exists. */
async function mirrorOneDeal(params: {
  workspaceId: string;
  dealObjId: string;
  dealRecordId: string;
  payload: Record<string, unknown>;
  auftragObjId: string | null;
  auftragDealRefAttrId: string | null;
}): Promise<number> {
  const { workspaceId, dealObjId, dealRecordId, payload, auftragObjId, auftragDealRefAttrId } =
    params;

  const deal = await getRecord(dealObjId, dealRecordId);
  if (!deal) return -1; // soft-deleted / gone — never mirror dead deals
  const dealValues = (deal.values ?? {}) as Record<string, unknown>;

  // ── 1. Collect slot values from the deal EAV (extraction write target). ──
  const slotValues = new Map<QualificationSlotKey, unknown>();
  for (const [slug, slotKey] of Object.entries(DEAL_SLUG_TO_SLOT)) {
    const v = dealValues[slug];
    if (!isEmptyValue(v)) slotValues.set(slotKey, v);
  }

  // elevator_from / elevator_to are select attributes — the EAV holds option
  // IDs. Store { optionId, title } so the mirror is readable stand-alone.
  const elevatorIds = (["elevator_from", "elevator_to"] as const)
    .map((slug) => dealValues[slug])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (elevatorIds.length > 0) {
    const optionRows = await db
      .select({ id: selectOptions.id, title: selectOptions.title })
      .from(selectOptions)
      .where(inArray(selectOptions.id, elevatorIds));
    const titleById = new Map(optionRows.map((o) => [o.id, o.title]));
    for (const slotKey of ["elevator_from", "elevator_to"] as const) {
      const id = dealValues[slotKey];
      if (typeof id === "string" && id.length > 0) {
        slotValues.set(slotKey, { optionId: id, title: titleById.get(id) ?? null });
      }
    }
  }

  // ── 2. Auftrag-level fields (volume, packing, Halteverbot, specials). ──
  let auftragValues: Record<string, unknown> = {};
  if (auftragObjId) {
    let auftragRecordId =
      typeof payload.auftragRecordId === "string" && payload.auftragRecordId
        ? payload.auftragRecordId
        : null;
    if (!auftragRecordId && auftragDealRefAttrId) {
      const [refRow] = await db
        .select({ recordId: recordValues.recordId })
        .from(recordValues)
        .innerJoin(records, eq(records.id, recordValues.recordId))
        .where(
          and(
            eq(records.objectId, auftragObjId),
            eq(recordValues.attributeId, auftragDealRefAttrId),
            eq(recordValues.referencedRecordId, dealRecordId)
          )
        )
        .limit(1);
      auftragRecordId = refRow?.recordId ?? null;
    }
    if (auftragRecordId) {
      const auftrag = await getRecord(auftragObjId, auftragRecordId);
      auftragValues = (auftrag?.values ?? {}) as Record<string, unknown>;
    }
  }
  if (!isEmptyValue(auftragValues.volume_cbm)) {
    slotValues.set("rooms_volume", auftragValues.volume_cbm);
  }
  if (!isEmptyValue(auftragValues.packing_service)) {
    slotValues.set("packing_service", auftragValues.packing_service);
  }
  if (!isEmptyValue(auftragValues.parking_halteverbot_needed)) {
    slotValues.set("parking_halteverbot", auftragValues.parking_halteverbot_needed);
  }

  // special_items = composite of everything special-items-ish the extraction
  // produced (deal inventory notes + Auftrag piano / special requests).
  const special: Record<string, unknown> = {};
  if (!isEmptyValue(dealValues.inventory_notes)) special.inventory_notes = dealValues.inventory_notes;
  if (!isEmptyValue(auftragValues.piano_transport)) special.piano_transport = auftragValues.piano_transport;
  if (!isEmptyValue(auftragValues.special_requests)) special.special_requests = auftragValues.special_requests;
  if (Object.keys(special).length > 0) slotValues.set("special_items", special);

  // ── 3. Missing slots from the event payload (missingFields + criticalMissing). ──
  const missingSlots = new Set<QualificationSlotKey>();
  if (Array.isArray(payload.criticalMissing)) {
    for (const entry of payload.criticalMissing as Array<{ field?: unknown }>) {
      if (typeof entry?.field !== "string") continue;
      const slot = INSIGHT_KEY_TO_SLOT[entry.field.trim().toLowerCase()];
      if (slot) missingSlots.add(slot);
    }
  }
  if (Array.isArray(payload.missingFields)) {
    for (const entry of payload.missingFields) {
      if (typeof entry !== "string") continue;
      const slot = slotFromMissingEntry(entry);
      if (slot) missingSlots.add(slot);
    }
  }
  // A value always wins over a (possibly stale) missing mention.
  for (const slotKey of slotValues.keys()) missingSlots.delete(slotKey);

  // ── 4. Upserts. Guards live in SQL (setWhere) so concurrent writers can
  //       never resurrect a refused/confirmed slot. `.returning` counts only
  //       rows actually written (guard-skipped conflicts return nothing). ──
  let written = 0;
  const now = new Date();

  for (const [slotKey, value] of slotValues) {
    const res = await db
      .insert(qualificationSlots)
      .values({
        workspaceId,
        dealRecordId,
        slotKey,
        status: "inferred",
        valueJson: value,
        // Mirror provenance is the extraction run, not a message: no
        // sourceMessageId, no confidence (both stay null).
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qualificationSlots.dealRecordId, qualificationSlots.slotKey],
        set: { status: "inferred", valueJson: value, updatedAt: now },
        setWhere: sql`${qualificationSlots.status} NOT IN ('refused', 'confirmed')`,
      })
      .returning({ id: qualificationSlots.id });
    written += res.length;
  }

  for (const slotKey of missingSlots) {
    const res = await db
      .insert(qualificationSlots)
      .values({
        workspaceId,
        dealRecordId,
        slotKey,
        status: "missing",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qualificationSlots.dealRecordId, qualificationSlots.slotKey],
        // Never downgrade: filled/confirmed/refused rows stay untouched.
        set: { status: "missing", updatedAt: now },
        setWhere: sql`${qualificationSlots.status} NOT IN ('filled', 'confirmed', 'refused')`,
      })
      .returning({ id: qualificationSlots.id });
    written += res.length;
  }

  return written;
}
