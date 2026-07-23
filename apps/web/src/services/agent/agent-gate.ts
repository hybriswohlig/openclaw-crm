/**
 * agentMayContact() — THE single eligibility predicate for every automated
 * customer-facing send (KI-Verkaufsassistent 2.0, docs/ai-sales-agent-plan.md).
 *
 * Design rules:
 *  - Deterministic SQL over typed state; no LLM involvement, no title regexes.
 *  - FAIL CLOSED everywhere: an unmapped stage, a DB error in the suppression
 *    lookup, or a missing deal all mean "do not contact". (The legacy
 *    isAgentSuppressed is fail-open by design for the old engines; agent paths
 *    must use the strict variant in this module.)
 *  - Evaluated at SEND time inside the send transaction, not at draft time
 *    (TOCTOU-safe). Callers pass the same input again right before sending.
 *  - Every verdict is returned as a full reason list for agent_events.gate_results.
 *
 * Phase 0: this module is NEW code, not yet wired into the legacy engines.
 * The legacy DECIDED/ADVANCED title regexes stay in place until a shadow-mode
 * diff shows zero divergence on must-not-contact cases (plan §6.2).
 */

import { db } from "@/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { objects, attributes, statuses } from "@/db/schema/objects";
import { recordValues, records } from "@/db/schema/records";
import { inboxConversations } from "@/db/schema/inbox";
import { agentSuppressions, dealAgentState, consentLedger } from "@/db/schema/agent";
import { canonicalizePhone, canonicalizeEmail } from "@/lib/identity/canonical";
import { isSalesAgentEnabled } from "./agent-config";

// ─── Message classes and their allowed stage categories ──────────────────────

export type AgentMessageClass =
  | "reply" // reactive turn in an open conversation
  | "slot_question" // reactive prequalification question
  | "ack" // reactive acknowledgment
  | "followup" // proactive nudge on a silent lead
  | "first_contact"; // proactive opener on a fresh lead

export type StageCategory =
  | "open_new"
  | "open_engaged"
  | "quoted"
  | "booked"
  | "done_unpaid"
  | "paid"
  | "lost";

/**
 * Which stage categories allow which message class. Everything not listed is
 * blocked; NULL/unknown categories are always blocked (fail closed). Reactive
 * classes stop at `quoted` — once an Angebot is out, the human owns the
 * conversation (the "Pablo" gate, made semantic instead of regex).
 */
const STAGE_ALLOWED: Record<AgentMessageClass, ReadonlySet<StageCategory>> = {
  reply: new Set(["open_new", "open_engaged"]),
  slot_question: new Set(["open_new", "open_engaged"]),
  ack: new Set(["open_new", "open_engaged"]),
  followup: new Set(["open_new", "open_engaged"]),
  first_contact: new Set(["open_new"]),
};

/** Proactive classes additionally require §7-UWG consent in the ledger. */
const NEEDS_PROACTIVE_CONSENT: ReadonlySet<AgentMessageClass> = new Set([
  "followup",
  "first_contact",
]);

/** Minimum gap between agent-initiated proactive touches on one deal. */
export const MIN_PROACTIVE_GAP_HOURS = 20;

// ─── Berlin send window ──────────────────────────────────────────────────────
// en-US locale + hour12:false deliberately: the de-DE formatter once yielded
// "17 Uhr" → Number() NaN → the window was permanently closed (commit 4882204).

function berlinParts(now: Date): { weekday: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "";
  const hour = Number.parseInt(hourRaw, 10);
  return { weekday, hour: Number.isFinite(hour) ? hour % 24 : NaN };
}

/** Mon–Sat 08–20, Sun 10–19, Europe/Berlin. NaN hour = closed (fail closed). */
export function isWithinSendWindow(now: Date = new Date()): boolean {
  const { weekday, hour } = berlinParts(now);
  if (!Number.isFinite(hour)) return false;
  if (weekday === "Sun") return hour >= 10 && hour < 19;
  return hour >= 8 && hour < 20;
}

// ─── Strict (fail-closed) suppression check ──────────────────────────────────

/**
 * Like isAgentSuppressed, but a DB error means SUPPRESSED. Missing identifiers
 * count as "not suppressed" (a person without phone/email cannot be on the
 * list — the channel itself provides one of the two in practice).
 */
export async function isAgentSuppressedStrict(
  workspaceId: string,
  input: { phone?: string | null; email?: string | null }
): Promise<boolean> {
  const keys: string[] = [];
  const phone = canonicalizePhone(input.phone, "DE");
  if (phone) keys.push(phone);
  const email = canonicalizeEmail(input.email);
  if (email) keys.push(email);
  if (keys.length === 0) return false;
  try {
    const [row] = await db
      .select({ id: agentSuppressions.id })
      .from(agentSuppressions)
      .where(
        and(
          eq(agentSuppressions.workspaceId, workspaceId),
          // inArray, NOT a raw sql`` array — the raw form serialized the JS
          // array as one text param and silently broke the lookup (a53f515).
          inArray(agentSuppressions.valueCanonical, keys)
        )
      )
      .limit(1);
    return Boolean(row);
  } catch (err) {
    console.error("[agent-gate] suppression lookup failed — FAILING CLOSED:", err);
    return true;
  }
}

// ─── Deal stage category resolution ──────────────────────────────────────────

interface DealStage {
  statusId: string | null;
  title: string | null;
  category: StageCategory | null;
  isTerminal: boolean;
}

/**
 * Resolve the deal's stage row via the EAV path:
 * records → record_values(stage attribute) → statuses. Returns nulls when any
 * link is missing (deleted deal, no stage value, orphaned status id) — all of
 * which the gate treats as blocking.
 */
export async function getDealStageCategory(
  workspaceId: string,
  dealRecordId: string
): Promise<DealStage> {
  const [row] = await db
    .select({
      statusId: statuses.id,
      title: statuses.title,
      category: statuses.stageCategory,
      isTerminal: statuses.isTerminal,
    })
    .from(records)
    .innerJoin(objects, and(eq(objects.id, records.objectId), eq(objects.workspaceId, workspaceId)))
    .innerJoin(
      attributes,
      and(eq(attributes.objectId, objects.id), eq(attributes.slug, "stage"))
    )
    .innerJoin(
      recordValues,
      and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, attributes.id))
    )
    .innerJoin(statuses, eq(statuses.id, recordValues.textValue))
    .where(and(eq(records.id, dealRecordId), isNull(records.deletedAt)))
    .limit(1);
  if (!row) return { statusId: null, title: null, category: null, isTerminal: false };
  return {
    statusId: row.statusId,
    title: row.title,
    category: (row.category as StageCategory | null) ?? null,
    isTerminal: row.isTerminal,
  };
}

// ─── The gate ────────────────────────────────────────────────────────────────

export interface GateInput {
  workspaceId: string;
  dealRecordId: string;
  messageClass: AgentMessageClass;
  /** The conversation the send would go out on (checked for aiPaused/hold/lane). */
  conversationId?: string | null;
  /** Person identifiers for the suppression check. */
  personRecordId?: string | null;
  phone?: string | null;
  email?: string | null;
  now?: Date;
}

export interface GateVerdict {
  allowed: boolean;
  /** Machine-readable block reasons; empty when allowed. */
  reasons: string[];
  /** Context captured for agent_events.gate_results forensics. */
  context: Record<string, unknown>;
}

/**
 * Deterministic pre-send gate. Collects ALL failing reasons (not just the
 * first) so shadow mode and forensics see the full picture.
 */
export async function agentMayContact(input: GateInput): Promise<GateVerdict> {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  const context: Record<string, unknown> = { messageClass: input.messageClass };

  // 1) Master switch (per-engine dry-run is enforced by the engines; the gate
  //    only cares whether the agent system is on at all).
  try {
    if (!(await isSalesAgentEnabled(input.workspaceId))) reasons.push("master_switch_off");
  } catch (err) {
    console.error("[agent-gate] master switch read failed — FAILING CLOSED:", err);
    reasons.push("master_switch_error");
  }

  // 2) Stage category (fail closed on unmapped/missing/terminal).
  const stage = await getDealStageCategory(input.workspaceId, input.dealRecordId);
  context.stage = stage;
  if (!stage.statusId) {
    reasons.push("deal_or_stage_missing");
  } else if (!stage.category) {
    reasons.push("stage_unmapped");
  } else {
    if (stage.isTerminal) reasons.push("stage_terminal");
    if (!STAGE_ALLOWED[input.messageClass].has(stage.category)) {
      reasons.push(`stage_disallows_${input.messageClass}`);
    }
  }

  // 3) Per-deal agent state: sticky human ownership + stop + min-gap.
  const [state] = await db
    .select()
    .from(dealAgentState)
    .where(eq(dealAgentState.dealRecordId, input.dealRecordId))
    .limit(1);
  if (state) {
    context.humanOwned = state.humanOwned;
    context.stopReason = state.stopReason;
    if (state.humanOwned) reasons.push("human_owned");
    if (state.stopReason) reasons.push(`stopped_${state.stopReason}`);
    if (
      NEEDS_PROACTIVE_CONSENT.has(input.messageClass) &&
      state.lastOutboundAt &&
      now.getTime() - state.lastOutboundAt.getTime() < MIN_PROACTIVE_GAP_HOURS * 3600_000
    ) {
      reasons.push("min_gap");
    }
  }

  // 4) Suppression list (STRICT: DB error = suppressed).
  if (await isAgentSuppressedStrict(input.workspaceId, { phone: input.phone, email: input.email })) {
    reasons.push("suppressed");
  }

  // 5) Consent for proactive classes (§7 UWG): needs an unrevoked
  //    proactive_followup grant for this person. Fail closed on lookup errors.
  if (NEEDS_PROACTIVE_CONSENT.has(input.messageClass)) {
    if (!input.personRecordId) {
      reasons.push("consent_unknown_person");
    } else {
      try {
        const [grant] = await db
          .select({ id: consentLedger.id })
          .from(consentLedger)
          .where(
            and(
              eq(consentLedger.workspaceId, input.workspaceId),
              eq(consentLedger.personRecordId, input.personRecordId),
              eq(consentLedger.purpose, "proactive_followup"),
              isNull(consentLedger.revokedAt)
            )
          )
          .limit(1);
        if (!grant) reasons.push("no_proactive_consent");
      } catch (err) {
        console.error("[agent-gate] consent lookup failed — FAILING CLOSED:", err);
        reasons.push("consent_lookup_error");
      }
    }
  }

  // 6) Conversation-level controls.
  if (input.conversationId) {
    const [conv] = await db
      .select({
        aiPaused: inboxConversations.aiPaused,
        aiHoldUntil: inboxConversations.aiHoldUntil,
        lane: inboxConversations.lane,
      })
      .from(inboxConversations)
      .where(eq(inboxConversations.id, input.conversationId))
      .limit(1);
    if (!conv) {
      reasons.push("conversation_missing");
    } else {
      context.lane = conv.lane;
      if (conv.aiPaused) reasons.push("ai_paused");
      if (conv.aiHoldUntil && conv.aiHoldUntil.getTime() > now.getTime()) reasons.push("ai_hold");
      if (conv.lane !== "lead") reasons.push("lane_not_lead");
    }
  } else if (input.messageClass !== "first_contact") {
    // Reactive classes must name the thread they reply on.
    reasons.push("conversation_required");
  }

  // 7) Quiet hours (proactive classes only; replies may go out whenever the
  //    customer just wrote).
  if (NEEDS_PROACTIVE_CONSENT.has(input.messageClass) && !isWithinSendWindow(now)) {
    reasons.push("outside_send_window");
  }

  return { allowed: reasons.length === 0, reasons, context };
}

// ─── Sticky human ownership ──────────────────────────────────────────────────

/**
 * Mark a deal as human-owned (idempotent upsert). Called from every operator
 * outbound path: inbox UI sends AND the Baileys phone-echo ingest. Only an
 * explicit releaseHumanOwnership() clears it — never silence, never a cron.
 */
export async function setHumanOwned(
  workspaceId: string,
  dealRecordId: string,
  userId?: string | null
): Promise<void> {
  await db
    .insert(dealAgentState)
    .values({
      dealRecordId,
      workspaceId,
      humanOwned: true,
      humanOwnedBy: userId ?? null,
      humanOwnedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dealAgentState.dealRecordId,
      set: {
        humanOwned: true,
        humanOwnedBy: userId ?? null,
        humanOwnedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

/** Explicit UI release action — the only path back to agent eligibility. */
export async function releaseHumanOwnership(
  workspaceId: string,
  dealRecordId: string
): Promise<void> {
  await db
    .update(dealAgentState)
    .set({ humanOwned: false, humanReleasedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(dealAgentState.dealRecordId, dealRecordId),
        eq(dealAgentState.workspaceId, workspaceId)
      )
    );
}
