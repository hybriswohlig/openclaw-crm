/**
 * Phase-1 SHADOW MODE instrumentation (docs/ai-sales-agent-plan.md, Phase 1).
 *
 * The legacy engines keep deciding with their existing regex gates; this module
 * runs the NEW agentMayContact() gate in parallel and records both verdicts,
 * captures drafts into the approval-queue table, and writes liveness
 * heartbeats. NOTHING here may ever change engine behavior:
 *
 *   - every export catches ALL its own errors (log + continue),
 *   - nothing throws, nothing sends, nothing mutates engine-owned state,
 *   - agent_events is append-only (INSERT only — the DB trigger enforces it).
 *
 * The weekly shadow report (scripts/shadow-report.ts) aggregates these rows:
 * divergence between legacy and new gate is the Phase-1 exit metric
 * ("0 eligibility false-passes": the new gate must never ALLOW where the deal
 * is terminal/human-owned/suppressed — legacy_block_gate_allow rows on
 * must-not-contact grounds must be zero).
 */

import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents, agentDrafts } from "@/db/schema/agent";
import { sendPush } from "@/services/push";
import { leaksPriceOrCommitment } from "./agent-suppress";
import { ownerUserIds } from "./agent-shared";
import {
  agentMayContact,
  type AgentMessageClass,
  type GateVerdict,
} from "./agent-gate";

export type ShadowEngine = "reply" | "followup" | "first_contact";

/** Marks every shadow row so the report can filter cleanly. */
const SHADOW_PROMPT_VERSION = "shadow-v1";

export interface ShadowGateInput {
  workspaceId: string;
  engine: ShadowEngine;
  messageClass: AgentMessageClass;
  dealRecordId?: string | null;
  conversationId?: string | null;
  personRecordId?: string | null;
  phone?: string | null;
  email?: string | null;
  /**
   * What the legacy engine decided at its FINAL decision point for this
   * conversation/lead this tick, e.g. 'ask' | 'handoff' | 'no_op'
   * | 'skip_advanced_stage' | 'skip_suppressed' | 'skip_declined'
   * | 'skip_not_customer_turn' | 'skip_move_date_past' | 'skip_window'
   * | 'skip_daily_cap' | 'error'. Free string — report buckets by it.
   */
  legacyAction: string;
  /** Would the legacy engine have SENT a message if it were live? */
  legacyWouldSend: boolean;
}

/**
 * Run the new gate in parallel and record the divergence row. Returns the
 * verdict (or null on any failure) so callers MAY attach it to a captured
 * draft — but callers must never branch engine behavior on it.
 */
export async function recordShadowGate(input: ShadowGateInput): Promise<GateVerdict | null> {
  try {
    let verdict: GateVerdict | null = null;
    if (input.dealRecordId) {
      verdict = await agentMayContact({
        workspaceId: input.workspaceId,
        dealRecordId: input.dealRecordId,
        conversationId: input.conversationId ?? null,
        messageClass: input.messageClass,
        personRecordId: input.personRecordId ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
      });
    }
    const gateAllowed = verdict?.allowed ?? false;
    const divergence =
      input.legacyWouldSend && !gateAllowed
        ? "legacy_send_gate_block"
        : !input.legacyWouldSend && gateAllowed
          ? "legacy_block_gate_allow"
          : "agree";
    await db.insert(agentEvents).values({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId ?? null,
      conversationId: input.conversationId ?? null,
      engine: input.engine,
      eventType: "shadow_gate",
      promptVersion: SHADOW_PROMPT_VERSION,
      gateResults: {
        legacy: { action: input.legacyAction, wouldSend: input.legacyWouldSend },
        gate: verdict
          ? { allowed: verdict.allowed, reasons: verdict.reasons, context: verdict.context }
          : { allowed: false, reasons: ["no_deal_linked"], context: {} },
        divergence,
        messageClass: input.messageClass,
      },
    });
    return verdict;
  } catch (err) {
    console.error("[agent-shadow] recordShadowGate failed (non-blocking):", err);
    return null;
  }
}

export interface ShadowDraftInput {
  workspaceId: string;
  engine: ShadowEngine;
  messageClass: AgentMessageClass;
  dealRecordId: string;
  conversationId?: string | null;
  channelAccountId?: string | null;
  /** The raw model draft (pre-humanizer). */
  draftText: string;
  /** The final text as it WOULD have been sent (post-humanizer/signature), if available. */
  finalText?: string | null;
  gate?: GateVerdict | null;
  modelTag?: string | null;
}

/** German notification labels per message class (push title). */
export const DRAFT_CLASS_LABELS: Record<AgentMessageClass, string> = {
  reply: "Antwort",
  slot_question: "Rückfrage",
  ack: "Bestätigung",
  followup: "Follow-up",
  first_contact: "Erstkontakt",
};

/**
 * Gate block reasons a human can plausibly act on (consent/switch/window).
 * Drafts blocked ONLY on these are still worth a push; anything beyond
 * (terminal stage, human-owned, suppressed, …) is informational shadow noise.
 */
export const HUMAN_ACTIONABLE_BLOCKS: ReadonlySet<string> = new Set([
  "no_proactive_consent",
  "master_switch_off",
  "outside_send_window",
]);

/**
 * Capture a dry-run draft into agent_drafts (status 'pending', 72h expiry).
 * Idempotent per (engine, thread, draft content): overlapping cron ticks or
 * re-runs never duplicate a row. Runs the deterministic price/commitment scan
 * on the most final text available and stores the verdict.
 *
 * A genuinely NEW row (no idempotency conflict) additionally triggers a
 * best-effort web push to the owner users so drafts are seen without watching
 * the inbox — never for conflict re-runs, never for gate-blocked shadow noise.
 */
export async function captureShadowDraft(input: ShadowDraftInput): Promise<void> {
  try {
    const scanTarget = input.finalText?.trim() || input.draftText;
    const contentHash = createHash("sha1").update(scanTarget).digest("hex").slice(0, 16);
    const threadKey = input.conversationId ?? input.dealRecordId;
    // The repeat unit is the deal's WAITING STATE, not the LLM text: the
    // follow-up cron re-composes a (nondeterministic) nudge for the same
    // silent lead every day, which would insert a "new" row and re-push
    // daily. One live pending draft per (deal, class) is the queue's contract.
    const [alreadyPending] = await db
      .select({ id: agentDrafts.id })
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.dealRecordId, input.dealRecordId),
          eq(agentDrafts.messageClass, input.messageClass),
          eq(agentDrafts.status, "pending"),
          or(isNull(agentDrafts.expiresAt), gt(agentDrafts.expiresAt, new Date()))
        )
      )
      .limit(1);
    if (alreadyPending) return;
    const inserted = await db
      .insert(agentDrafts)
      .values({
        workspaceId: input.workspaceId,
        dealRecordId: input.dealRecordId,
        conversationId: input.conversationId ?? null,
        channelAccountId: input.channelAccountId ?? null,
        messageClass: input.messageClass,
        draftText: input.draftText,
        finalText: input.finalText ?? null,
        filterVerdicts: {
          priceOrCommitmentLeak: leaksPriceOrCommitment(scanTarget),
          scannedText: input.finalText ? "final" : "draft",
        },
        gateResults: input.gate
          ? { allowed: input.gate.allowed, reasons: input.gate.reasons }
          : null,
        status: "pending",
        idempotencyKey: `shadow:${input.engine}:${threadKey}:${contentHash}`,
        expiresAt: new Date(Date.now() + 72 * 3600_000),
        promptVersion: SHADOW_PROMPT_VERSION,
        modelTag: input.modelTag ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: agentDrafts.id });

    // Push ONLY on a real insert (onConflictDoNothing returns [] on conflict,
    // so re-runs/overlapping cron ticks stay silent). Own try/catch: a push
    // failure must never surface to engines.
    try {
      const gate = input.gate;
      const pushable =
        inserted.length > 0 &&
        gate != null &&
        (gate.allowed || gate.reasons.every((r) => HUMAN_ACTIONABLE_BLOCKS.has(r)));
      if (pushable) {
        const owners = await ownerUserIds(input.workspaceId);
        if (owners.length > 0) {
          await sendPush(
            {
              title: `KI-Entwurf: ${DRAFT_CLASS_LABELS[input.messageClass] ?? "Entwurf"}`,
              body: scanTarget.slice(0, 80),
              url: input.conversationId
                ? `/inbox?conversationId=${input.conversationId}`
                : "/inbox",
              tag: `agent-draft-${inserted[0].id}`,
            },
            { workspaceId: input.workspaceId, userIds: owners }
          );
        }
      }
    } catch (err) {
      console.error("[agent-shadow] draft push failed (non-blocking):", err);
    }
  } catch (err) {
    console.error("[agent-shadow] captureShadowDraft failed (non-blocking):", err);
  }
}

/**
 * One heartbeat per engine per cron tick, ALSO when zero work was found —
 * absence of heartbeats is how the report detects the silent no-op failure
 * class (raw-Date bug, NaN send window) that plagued the first agent.
 */
export async function shadowHeartbeat(
  workspaceId: string,
  engine: ShadowEngine,
  counters: Record<string, number>
): Promise<void> {
  try {
    await db.insert(agentEvents).values({
      workspaceId,
      engine,
      eventType: "heartbeat",
      promptVersion: SHADOW_PROMPT_VERSION,
      payload: counters,
    });
  } catch (err) {
    console.error("[agent-shadow] shadowHeartbeat failed (non-blocking):", err);
  }
}
