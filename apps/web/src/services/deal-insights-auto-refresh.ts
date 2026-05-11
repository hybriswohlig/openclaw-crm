/**
 * Nightly auto-refresh of "In Kontakt" leads.
 *
 * For each deal whose stage is "In Kontakt" AND whose linked conversations
 * have a new message since the last log entry, run extractDealInsights +
 * applyDealInsights with a tight whitelist.
 *
 * Whitelist rules (per user spec):
 *   - All deal-level chat-derivable fields: customer-name, phone, email,
 *     move_date, addresses, floors, elevators, value.
 *   - Auftrag chat-derivable fields: volume, dismantling, packing,
 *     piano_transport, disposal, storage, halteverbot, time windows,
 *     special_requests, payment_method, walking distances, contact
 *     names/phones, outstanding amount.
 *   - PROTECTED (never auto-touched, manual-only):
 *       • worker_count   (operational planning)
 *       • transporter    (operational planning)
 *       • assignedEmployees (not in this list anyway — separate table)
 *   - Stage moves are FORWARD-ONLY along:
 *       Neue Anfrage → In Kontakt → Geplant → Durchgeführt
 *                                                ↘  Bezahlt (Abgeschlossen)
 *     Verloren is a forward terminal too. Backward moves rejected.
 */
import { db } from "@/db";
import { records, recordValues } from "@/db/schema/records";
import { objects, attributes, statuses } from "@/db/schema/objects";
import {
  inboxConversations,
  inboxMessages,
} from "@/db/schema/inbox";
import { dealInsightsRefreshLog } from "@/db/schema/ai";
import { and, eq, inArray, sql } from "drizzle-orm";
import { extractDealInsights } from "./deal-insights";
import { applyDealInsights } from "./deal-insights-apply";

const AUTO_REFRESH_DEAL_FIELDS = [
  "inventory_notes",
  "move_date",
  "estimated_value_eur",
  "move_from_address",
  "move_to_address",
  "floors_from",
  "floors_to",
  "elevator_from",
  "elevator_to",
];

const AUTO_REFRESH_AUFTRAG_FIELDS = [
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
  "equipment_needed",
  "walking_distance_from_m",
  "walking_distance_to_m",
  "contact_pickup_name",
  "contact_pickup_phone",
  "contact_dropoff_name",
  "contact_dropoff_phone",
  "amount_outstanding_eur",
  // NOTE: worker_count + transporter intentionally excluded — those are
  // your operational decisions, only manually updatable via /KI-Analyse.
];

const STAGE_FORWARD_ORDER = [
  "neue anfrage",
  "in kontakt",
  "geplant",
  "durchgeführt",
  "bezahlt (abgeschlossen)",
  "verloren",
];

function stageIndex(title: string): number {
  return STAGE_FORWARD_ORDER.indexOf(title.toLowerCase());
}

export interface RefreshSummary {
  totalCandidates: number;
  skippedNoNewMessages: number;
  refreshed: number;
  failed: number;
  perDeal: Array<{
    dealRecordId: string;
    status: "refreshed" | "skipped" | "failed";
    fieldsUpdated?: string[];
    stageMoved?: { from: string | null; to: string | null } | null;
    error?: string;
  }>;
}

export async function refreshInContactLeads(
  workspaceId: string
): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    totalCandidates: 0,
    skippedNoNewMessages: 0,
    refreshed: 0,
    failed: 0,
    perDeal: [],
  };

  // 1. Resolve deals object + "In Kontakt" status id.
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) {
    console.warn(`[auto-refresh] no deals object for workspace ${workspaceId}`);
    return summary;
  }

  const [stageAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
    .limit(1);
  if (!stageAttr) {
    console.warn(`[auto-refresh] no stage attribute for deals object`);
    return summary;
  }

  const stageRows = await db
    .select()
    .from(statuses)
    .where(eq(statuses.attributeId, stageAttr.id));
  const inKontakt = stageRows.find(
    (s) => s.title.toLowerCase() === "in kontakt"
  );
  if (!inKontakt) {
    console.warn(`[auto-refresh] "In Kontakt" stage not found`);
    return summary;
  }

  // 2. Find all deal records that have stage = "In Kontakt".
  const stageValueRows = await db
    .select({ recordId: recordValues.recordId })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.attributeId, stageAttr.id),
        eq(recordValues.textValue, inKontakt.id)
      )
    );

  const candidateDealIds = [...new Set(stageValueRows.map((r) => r.recordId))];
  summary.totalCandidates = candidateDealIds.length;
  if (candidateDealIds.length === 0) return summary;

  // 3. For each deal, find the most recent inbox message timestamp.
  const recentByDeal = new Map<string, Date | null>();
  const convRows = await db
    .select({
      dealRecordId: inboxConversations.dealRecordId,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        inArray(inboxConversations.dealRecordId, candidateDealIds)
      )
    );
  for (const c of convRows) {
    if (!c.dealRecordId) continue;
    const existing = recentByDeal.get(c.dealRecordId);
    if (
      !existing ||
      (c.lastMessageAt && c.lastMessageAt.getTime() > existing.getTime())
    ) {
      recentByDeal.set(c.dealRecordId, c.lastMessageAt);
    }
  }

  // 4. Load existing refresh-log rows so we can skip deals with no new
  // messages since their last run.
  const logRows = await db
    .select()
    .from(dealInsightsRefreshLog)
    .where(
      and(
        eq(dealInsightsRefreshLog.workspaceId, workspaceId),
        inArray(dealInsightsRefreshLog.dealRecordId, candidateDealIds)
      )
    );
  const logByDeal = new Map(logRows.map((r) => [r.dealRecordId, r]));

  // 5. Iterate. Throttle to ≤1 deal per 2s to be friendly to OpenRouter.
  for (const dealRecordId of candidateDealIds) {
    const lastMessageAt = recentByDeal.get(dealRecordId) ?? null;
    const log = logByDeal.get(dealRecordId);
    const lastSeen = log?.lastMessageAtSeen ?? null;

    // Skip if there's no message OR no NEW message since the last run.
    if (!lastMessageAt) {
      summary.skippedNoNewMessages++;
      summary.perDeal.push({ dealRecordId, status: "skipped" });
      continue;
    }
    if (lastSeen && lastSeen.getTime() >= lastMessageAt.getTime()) {
      summary.skippedNoNewMessages++;
      summary.perDeal.push({ dealRecordId, status: "skipped" });
      continue;
    }

    try {
      const { insights } = await extractDealInsights(workspaceId, dealRecordId);
      if (!insights) {
        summary.failed++;
        summary.perDeal.push({
          dealRecordId,
          status: "failed",
          error: "extraction returned no insights",
        });
        continue;
      }

      // Forward-only stage gate: if the AI suggests a stage that's BEFORE
      // the current one in the canonical order, drop the suggestion.
      const fromIdx = stageIndex(inKontakt.title);
      const suggestedIdx = insights.suggested_stage
        ? stageIndex(insights.suggested_stage)
        : -1;
      const allowStageMove = suggestedIdx > fromIdx; // strictly forward

      const applyResult = await applyDealInsights({
        workspaceId,
        dealRecordId,
        insights,
        appliedBy: null, // attributed to the cron / "KI" actor
        selectedFields: [
          ...AUTO_REFRESH_DEAL_FIELDS,
          ...AUTO_REFRESH_AUFTRAG_FIELDS,
        ],
        applyStage: allowStageMove,
        applyNote: true,
        applyContact: true,
        applyAuftrag: true,
      });

      // 6. Upsert the refresh log row.
      const updatedSummary = [
        ...applyResult.fieldsUpdated,
        ...applyResult.contactUpdated.map((s) => `contact:${s}`),
        ...applyResult.auftragUpdated.map((s) => `auftrag:${s}`),
      ];
      await db
        .insert(dealInsightsRefreshLog)
        .values({
          dealRecordId,
          workspaceId,
          refreshedAt: new Date(),
          lastMessageAtSeen: lastMessageAt,
          fieldsUpdated: JSON.stringify(updatedSummary),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: dealInsightsRefreshLog.dealRecordId,
          set: {
            refreshedAt: new Date(),
            lastMessageAtSeen: lastMessageAt,
            fieldsUpdated: JSON.stringify(updatedSummary),
            updatedAt: new Date(),
          },
        });

      summary.refreshed++;
      summary.perDeal.push({
        dealRecordId,
        status: "refreshed",
        fieldsUpdated: updatedSummary,
        stageMoved: applyResult.stageUpdated
          ? { from: inKontakt.title, to: insights.suggested_stage ?? null }
          : null,
      });

      // Throttle — OpenRouter is fine with bursts but the underlying
      // models sometimes 429. 2s sleep keeps us well under any limit.
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(
        `[auto-refresh] failed for deal ${dealRecordId}:`,
        err instanceof Error ? err.message : err
      );
      summary.failed++;
      summary.perDeal.push({
        dealRecordId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

/** Convenience: run the refresh across every workspace in the database. */
export async function refreshInContactLeadsGlobal() {
  const wsRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM workspaces`
  );
  const summaries: Array<{ workspaceId: string; summary: RefreshSummary }> = [];
  for (const w of wsRows as unknown as Array<{ id: string }>) {
    const summary = await refreshInContactLeads(w.id);
    summaries.push({ workspaceId: w.id, summary });
  }
  return summaries;
}
