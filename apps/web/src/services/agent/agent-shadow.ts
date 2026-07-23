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
import { db } from "@/db";
import { agentEvents, agentDrafts } from "@/db/schema/agent";
import { leaksPriceOrCommitment } from "./agent-suppress";
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

/**
 * Capture a dry-run draft into agent_drafts (status 'pending', 72h expiry).
 * Idempotent per (engine, thread, draft content): overlapping cron ticks or
 * re-runs never duplicate a row. Runs the deterministic price/commitment scan
 * on the most final text available and stores the verdict.
 */
export async function captureShadowDraft(input: ShadowDraftInput): Promise<void> {
  try {
    const scanTarget = input.finalText?.trim() || input.draftText;
    const contentHash = createHash("sha1").update(scanTarget).digest("hex").slice(0, 16);
    const threadKey = input.conversationId ?? input.dealRecordId;
    await db
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
      .onConflictDoNothing();
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
