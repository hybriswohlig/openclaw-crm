/**
 * Pure rules for human approval of an agent draft.
 *
 * human_owned and ai_paused exist so the agent does not auto-send into a
 * thread a person already owns. A recorded human approval lifts only those
 * two. Safety blocks (price, expiry, consent, send errors) stay in force.
 * Approving one message must not clear the conversation's ai_paused flag or
 * the deal's human_owned flag — the thread stays with the human.
 */

/** Auto-send gates a recorded human approval lifts. */
export const HUMAN_APPROVAL_LIFTS: readonly string[] = ["human_owned", "ai_paused"];

/** Opt-in block. Lifted only by an explicit override together with human approval. */
export const CONSENT_GATE = "no_proactive_consent";

/**
 * Statuses that will never be sent. Closing them again is a successful no-op
 * so a caller retrying after a manual send does not see updated:false.
 */
export const TERMINAL_DRAFT_STATUSES: ReadonlySet<string> = new Set([
  "dismissed",
  "edited",
  "superseded",
  "cancelled",
  "sent",
  "expired",
  "auto_sent",
  "gate_blocked",
]);

export type CloseStatus = "dismissed" | "edited" | "superseded";

export interface ClosePlan {
  /** Canonical action after aliases are folded. */
  action: "dismiss" | "mark_taken" | "taken";
  status: CloseStatus;
  /** Statuses this action may transition. */
  from: readonly string[];
}

export function flagTrue(v: unknown): boolean {
  return v === true || v === "true";
}

export function optionalText(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export interface HumanApprovalRecord {
  humanApproved: true;
  approvedBy: string | null;
  note: string | null;
  /** True only when the caller sent overrideConsent together with humanApproved. */
  overrideConsent: boolean;
  at: string;
}

export function humanApprovalRecord(input: {
  approvedBy?: string | null;
  note?: string | null;
  overrideConsent?: boolean;
  at?: string;
}): HumanApprovalRecord {
  return {
    humanApproved: true,
    approvedBy: optionalText(input.approvedBy),
    note: optionalText(input.note),
    overrideConsent: input.overrideConsent === true,
    at: input.at ?? new Date().toISOString(),
  };
}

/**
 * Gate reasons that still block a send after optional human approval.
 * overrideConsent is ignored unless humanApproved is also true.
 */
export function gateReasonsBlockingSend(input: {
  reasons: readonly string[];
  /** Reasons this caller already treats as overridable (e.g. master_switch_off). */
  overridable?: ReadonlySet<string>;
  humanApproved?: boolean;
  overrideConsent?: boolean;
}): { blocking: string[]; consentOverridden: boolean } {
  const lifted = new Set(input.overridable ?? []);
  const human = input.humanApproved === true;
  const consentRequested = human && input.overrideConsent === true;
  if (human) {
    for (const reason of HUMAN_APPROVAL_LIFTS) lifted.add(reason);
    if (consentRequested) lifted.add(CONSENT_GATE);
  }
  const blocking = input.reasons.filter((reason) => !lifted.has(reason));
  const consentOverridden = consentRequested && input.reasons.includes(CONSENT_GATE);
  return { blocking, consentOverridden };
}

/**
 * The only deal_agent_state write on a successful draft send.
 * Must not include humanOwned — an existing true must stay true.
 */
export function outboundStateTouch(now: Date): { lastOutboundAt: Date; updatedAt: Date } {
  return { lastOutboundAt: now, updatedAt: now };
}

/**
 * Close actions that do not send. Aliases:
 *   dismiss | dismissed
 *   mark_taken | mark_sent_manually  → superseded
 *   taken                              → edited (composer pull, kept for the banner)
 */
export function parseCloseAction(action: string): ClosePlan | null {
  if (action === "dismiss" || action === "dismissed") {
    return { action: "dismiss", status: "dismissed", from: ["pending", "send_uncertain"] };
  }
  if (action === "mark_taken" || action === "mark_sent_manually") {
    return { action: "mark_taken", status: "superseded", from: ["pending"] };
  }
  if (action === "taken") {
    return { action: "taken", status: "edited", from: ["pending"] };
  }
  return null;
}

export function decideDraftClose(
  plan: ClosePlan,
  currentStatus: string
): { kind: "update"; status: CloseStatus } | { kind: "idempotent" } | { kind: "noop" } {
  if (plan.from.includes(currentStatus)) return { kind: "update", status: plan.status };
  if (currentStatus === plan.status || TERMINAL_DRAFT_STATUSES.has(currentStatus)) {
    return { kind: "idempotent" };
  }
  // approved (send in flight) and send_uncertain (for mark_taken) stay put.
  return { kind: "noop" };
}
