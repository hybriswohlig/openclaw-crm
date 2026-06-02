/**
 * Post-quote scope-change guard.
 *
 * Freezes the price-driving move scope (inventory, volume, floors, piano,
 * packing, disposal, storage) at the moment a quote is issued, then on every
 * later KI extraction diffs the live scope against that frozen baseline. If the
 * customer changed the scope after we quoted, the team is WARNED — the
 * originally-quoted scope is never silently overwritten.
 *
 * Two commitment tiers:
 *   - link_issued : a quotation/customer link exists. Warn; live fields may
 *     still update (the immutable snapshot preserves the original).
 *   - kva_accepted: the customer accepted the KVA. Hard-lock — the apply layer
 *     must route the new scope to pending_* fields, not overwrite the quoted
 *     scope.
 */

import { db } from "@/db";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { quotationScopeSnapshots } from "@/db/schema/quotations";
import { kvaConfirmations } from "@/db/schema/customer-portal";
import { and, desc, eq } from "drizzle-orm";
import { getRecord, updateRecord } from "./records";
import { getQuotation } from "./quotations";
import { emitEvent } from "./activity-events";
import { createNotification } from "./notifications";
import { listMembers } from "./workspace";
import { sendPush } from "./push";
import { createTask } from "./tasks";

export type CommitmentTier = "link_issued" | "kva_accepted";

/** The price-driver scope we freeze and diff. */
export interface ScopeData {
  inventory_notes: string | null;
  volume_cbm: number | null;
  floors_from: number | null;
  floors_to: number | null;
  piano_transport: boolean | null;
  dismantling_required: boolean | null;
  packing_service: boolean | null;
  disposal_required: boolean | null;
  storage_required: boolean | null;
  special_requests: string | null;
}

const NUMERIC_DRIVERS = ["volume_cbm", "floors_from", "floors_to"] as const;
const BOOLEAN_DRIVERS = [
  "piano_transport",
  "dismantling_required",
  "packing_service",
  "disposal_required",
  "storage_required",
] as const;

const DRIVER_LABELS: Record<string, string> = {
  inventory_notes: "Inventar",
  volume_cbm: "Volumen (m³)",
  floors_from: "Stockwerk Abholung",
  floors_to: "Stockwerk Ziel",
  piano_transport: "Klaviertransport",
  dismantling_required: "Demontage",
  packing_service: "Einpackservice",
  disposal_required: "Sperrmüll / Entsorgung",
  storage_required: "Einlagerung",
  special_requests: "Sonderwünsche",
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v: unknown): boolean | null {
  if (v == null) return null;
  return Boolean(v);
}
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

async function resolveObjectId(workspaceId: string, slug: string): Promise<string | null> {
  const [o] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, slug)))
    .limit(1);
  return o?.id ?? null;
}

/** Resolve the Auftrag record id linked to a deal (via the `deal` reference attribute). */
async function findAuftragRecordId(
  workspaceId: string,
  dealRecordId: string
): Promise<{ auftragObjId: string; auftragRecordId: string } | null> {
  const auftragObjId = await resolveObjectId(workspaceId, "auftraege");
  if (!auftragObjId) return null;
  const [dealRefAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, auftragObjId), eq(attributes.slug, "deal")))
    .limit(1);
  if (!dealRefAttr) return null;
  const [ref] = await db
    .select({ recordId: recordValues.recordId })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(
      and(
        eq(records.objectId, auftragObjId),
        eq(recordValues.attributeId, dealRefAttr.id),
        eq(recordValues.referencedRecordId, dealRecordId)
      )
    )
    .limit(1);
  if (!ref) return null;
  return { auftragObjId, auftragRecordId: ref.recordId };
}

/** Find the Auftrag record values linked to a deal (via the `deal` reference attribute). */
async function loadAuftragValues(
  workspaceId: string,
  dealRecordId: string
): Promise<Record<string, unknown>> {
  const found = await findAuftragRecordId(workspaceId, dealRecordId);
  if (!found) return {};
  const rec = await getRecord(found.auftragObjId, found.auftragRecordId);
  return (rec?.values ?? {}) as Record<string, unknown>;
}

/** Read the current price-driver scope from the deal + linked Auftrag records. */
export async function buildCurrentScope(
  workspaceId: string,
  dealRecordId: string
): Promise<ScopeData> {
  const dealObjId = await resolveObjectId(workspaceId, "deals");
  const dealVals = dealObjId
    ? ((await getRecord(dealObjId, dealRecordId))?.values ?? {})
    : {};
  const a = await loadAuftragValues(workspaceId, dealRecordId);
  const d = dealVals as Record<string, unknown>;
  return {
    inventory_notes: str(d.inventory_notes),
    volume_cbm: num(a.volume_cbm),
    floors_from: num(d.floors_from),
    floors_to: num(d.floors_to),
    piano_transport: bool(a.piano_transport),
    dismantling_required: bool(a.dismantling_required),
    packing_service: bool(a.packing_service),
    disposal_required: bool(a.disposal_required),
    storage_required: bool(a.storage_required),
    special_requests: str(a.special_requests),
  };
}

function quotedTotalCents(fixedPrice: string | null | undefined): number | null {
  if (!fixedPrice) return null;
  const n = parseFloat(fixedPrice);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Capture the scope baseline at quote issuance. Idempotent for 'issue': only
 * writes if no snapshot exists yet for the deal. For 'reissue_approved' it
 * always writes a fresh row (operator re-quoted after an approved change).
 */
export async function captureScopeSnapshot(
  workspaceId: string,
  dealRecordId: string,
  reason: "issue" | "reissue_approved" = "issue"
): Promise<void> {
  try {
    if (reason === "issue") {
      const [existing] = await db
        .select({ id: quotationScopeSnapshots.id })
        .from(quotationScopeSnapshots)
        .where(eq(quotationScopeSnapshots.dealRecordId, dealRecordId))
        .limit(1);
      if (existing) return; // baseline already anchored
    }
    const [scope, quotation] = await Promise.all([
      buildCurrentScope(workspaceId, dealRecordId),
      getQuotation(dealRecordId),
    ]);
    await db.insert(quotationScopeSnapshots).values({
      workspaceId,
      dealRecordId,
      capturedReason: reason,
      quotedTotalCents: quotedTotalCents(quotation?.fixedPrice),
      scope: scope as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Snapshotting must never block the quotation save.
    console.error("[scope-guard] captureScopeSnapshot failed:", err);
  }
}

export async function getLatestScopeSnapshot(dealRecordId: string) {
  try {
    const [row] = await db
      .select()
      .from(quotationScopeSnapshots)
      .where(eq(quotationScopeSnapshots.dealRecordId, dealRecordId))
      .orderBy(desc(quotationScopeSnapshots.capturedAt))
      .limit(1);
    return row ?? null;
  } catch (err) {
    // Table not migrated yet → feature degrades to off, never breaks KI-Analyse.
    console.warn("[scope-guard] getLatestScopeSnapshot unavailable:", err);
    return null;
  }
}

/** kva_accepted once the customer has confirmed the KVA; otherwise link_issued. */
export async function getCommitmentTier(dealRecordId: string): Promise<CommitmentTier> {
  try {
    const [kva] = await db
      .select({ id: kvaConfirmations.id })
      .from(kvaConfirmations)
      .where(eq(kvaConfirmations.dealRecordId, dealRecordId))
      .limit(1);
    return kva ? "kva_accepted" : "link_issued";
  } catch {
    return "link_issued";
  }
}

export interface ScopeChangeResult {
  changed: boolean;
  changedFields: string[];
  changedLabels: string[];
}

/**
 * Compare the freshly extracted scope against the quoted snapshot. Deterministic
 * for numeric/boolean price-drivers (any difference counts — max sensitivity);
 * the AI flag (aiChanged) covers the free-text inventory, where comparing raw
 * text is unreliable because the model re-summarizes each run.
 */
export function evaluateScopeChange(
  snap: ScopeData,
  ext: Record<string, unknown>,
  aiChanged: boolean
): ScopeChangeResult {
  const changedFields: string[] = [];

  for (const k of NUMERIC_DRIVERS) {
    const e = num(ext[k]);
    if (e == null) continue; // extraction didn't establish it → not a change
    const s = snap[k];
    if (s == null || Number(s) !== e) changedFields.push(k);
  }
  for (const k of BOOLEAN_DRIVERS) {
    const e = bool(ext[k]);
    if (e == null) continue;
    const s = snap[k] ?? false;
    if (Boolean(s) !== e) changedFields.push(k);
  }
  if (aiChanged) changedFields.push("inventory_notes");

  return {
    changed: changedFields.length > 0,
    changedFields,
    changedLabels: changedFields.map((f) => DRIVER_LABELS[f] ?? f),
  };
}

/**
 * Warn the whole workspace that the scope changed after a quote. Durable
 * (activity event) + in-app notification per member + push + a task. Every
 * channel swallows its own errors so the KI apply is never blocked.
 */
export async function dispatchScopeWarning(params: {
  workspaceId: string;
  dealRecordId: string;
  dealName: string;
  tier: CommitmentTier;
  change: ScopeChangeResult;
  snapshotId: string;
  quotedTotalCents: number | null;
  actorId: string | null;
}): Promise<void> {
  const { workspaceId, dealRecordId, dealName, tier, change, snapshotId, quotedTotalCents: qtc, actorId } = params;
  const whatChanged = change.changedLabels.join(", ") || "Umfang";
  const url = `/objects/deals/${dealRecordId}`;
  const title = "Umfang nach Angebot geändert";
  const body = `${dealName}: ${whatChanged} hat sich nach dem Angebot geändert. Bitte Preis prüfen.`;

  try {
    await emitEvent({
      workspaceId,
      recordId: dealRecordId,
      objectSlug: "deals",
      eventType: "deal.scope_changed_after_quote",
      actorId,
      payload: {
        tier,
        changedFields: change.changedFields,
        changedLabels: change.changedLabels,
        snapshotId,
        quotedTotalCents: qtc,
      },
    });
  } catch (err) {
    console.error("[scope-guard] emitEvent failed:", err);
  }

  // In-app notification to every workspace member.
  try {
    const members = await listMembers(workspaceId);
    await Promise.all(
      members.map((m) =>
        createNotification({
          workspaceId,
          userId: m.userId,
          type: "deal.scope_changed_after_quote",
          title,
          body,
          url,
          metadata: { dealRecordId, tier, changedFields: change.changedFields },
        }).catch(() => null)
      )
    );
  } catch (err) {
    console.error("[scope-guard] notifyWorkspace failed:", err);
  }

  // A task only at the stronger (accepted) tier, to keep noise down.
  if (tier === "kva_accepted" && actorId) {
    try {
      await createTask(`Preis prüfen: Umfang nach Angebot geändert (${whatChanged})`, actorId, workspaceId, {
        recordIds: [dealRecordId],
      });
    } catch (err) {
      console.error("[scope-guard] createTask failed:", err);
    }
  }

  // Push is best-effort and potentially slow → fire and forget.
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      sendPush({ title, body, url, tag: `scope-${dealRecordId}` }, { workspaceId }).then(
        () => undefined,
        () => undefined
      )
    );
  } catch {
    // @vercel/functions unavailable (local) → send inline, ignore errors.
    sendPush({ title, body, url, tag: `scope-${dealRecordId}` }, { workspaceId }).catch(() => null);
  }
}

/**
 * Resolve a flagged scope change.
 *   - "accept":  the operator re-quoted for the new scope. Promote the pending
 *     inventory/volume into the live fields, clear the flag, and re-anchor the
 *     baseline (a fresh snapshot) so the same change stops firing.
 *   - "dismiss": keep the originally-quoted scope; just clear the flag + pending.
 */
export async function resolveScopeChange(
  workspaceId: string,
  dealRecordId: string,
  action: "accept" | "dismiss",
  actorId: string | null
): Promise<void> {
  const dealObjId = await resolveObjectId(workspaceId, "deals");
  if (!dealObjId) return;
  const deal = await getRecord(dealObjId, dealRecordId);
  const v = (deal?.values ?? {}) as Record<string, unknown>;

  const dealInput: Record<string, unknown> = {
    scope_changed_after_quote: false,
    scope_change_tier: null,
    scope_change_flagged_at: null,
    pending_inventory_notes: null,
    pending_volume_cbm: null,
  };

  if (action === "accept") {
    const pendingInv = v.pending_inventory_notes;
    if (typeof pendingInv === "string" && pendingInv.trim()) {
      dealInput.inventory_notes = pendingInv.trim();
    }
    const pendingVol = num(v.pending_volume_cbm);
    if (pendingVol != null) {
      const found = await findAuftragRecordId(workspaceId, dealRecordId);
      if (found) {
        await updateRecord(found.auftragObjId, found.auftragRecordId, { volume_cbm: pendingVol }, actorId);
      }
    }
  }

  await updateRecord(dealObjId, dealRecordId, dealInput, actorId);

  if (action === "accept") {
    // Re-anchor the baseline to the now-current scope.
    await captureScopeSnapshot(workspaceId, dealRecordId, "reissue_approved");
  }
}
