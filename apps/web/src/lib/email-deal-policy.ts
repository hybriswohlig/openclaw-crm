/**
 * Whether a direct email may become a deal.
 *
 * Sure customer inquiry → auto. Uncertain → suggestion. Everything else → never.
 * The lane heuristic alone is not an input that can return "auto": a
 * classification is required. Portal mails (Kleinanzeigen, ImmoScout,
 * Möbeltransport24, Formspree) do not use this function; their parsers are the
 * certainty.
 */

import { isLeadKunde } from "@/lib/kontaktart";

export const EMAIL_DEAL_SOURCE = "E-Mail";
export const DEFAULT_EMAIL_DEAL_THRESHOLD = 0.85;

export type EmailDealVerdict = "kundenanfrage" | "kein_kunde" | "unsicher";
export type EmailDealAction = "auto" | "suggest" | "never";

export interface EmailDealClassification {
  verdict: EmailDealVerdict;
  confidence: number;
  /** The quote was found verbatim in the mail. Required for auto. */
  evidenceInText: boolean;
}

export interface EmailDealDecisionInput {
  lane: string | null | undefined;
  kontaktart: string | null | undefined;
  hasDeal: boolean;
  /** In-Reply-To / References point at a message we sent. */
  replyToOwnMail: boolean;
  suggestionsEnabled: boolean;
  autoWriteEnabled: boolean;
  threshold: number;
  /** Null when no model result exists. That can never auto-create. */
  classification: EmailDealClassification | null;
}

export interface EmailDealDecision {
  action: EmailDealAction;
  reason: string;
}

export function referencedMessageIds(input: {
  inReplyTo?: string | null;
  references?: string | string[] | null;
}): string[] {
  const rawRefs = input.references;
  const refs = Array.isArray(rawRefs) ? rawRefs : rawRefs ? [rawRefs] : [];
  const ids = [input.inReplyTo, ...refs].filter((value): value is string => !!value && value.trim().length > 0);
  return [...new Set(ids.map((id) => id.trim()))];
}

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EMAIL_DEAL_THRESHOLD;
  return Math.min(1, Math.max(0, value));
}

function clampConfidence(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  if (scaled <= 0 || scaled > 1) return null;
  return scaled;
}

/**
 * Hard stops first (Kontaktart, lane, reply, existing deal, kill switch).
 * A missing classification is never an automatic deal.
 */
export function decideEmailDeal(input: EmailDealDecisionInput): EmailDealDecision {
  if (input.hasDeal) return { action: "never", reason: "has_deal" };
  if (input.replyToOwnMail) return { action: "never", reason: "reply_to_own_mail" };
  const lane = (input.lane ?? "").trim();
  if (lane === "kein_lead" || lane === "spam") return { action: "never", reason: "lane_blocked" };
  if (lane !== "lead") return { action: "never", reason: "lane_not_lead" };
  if (!isLeadKunde(input.kontaktart)) return { action: "never", reason: "kontaktart" };
  if (!input.suggestionsEnabled && !input.autoWriteEnabled) {
    return { action: "never", reason: "kill_switch" };
  }
  if (!input.classification) return { action: "never", reason: "no_classification" };

  const confidence = clampConfidence(input.classification.confidence);
  if (confidence == null) {
    return input.suggestionsEnabled
      ? { action: "suggest", reason: "invalid_confidence" }
      : { action: "never", reason: "invalid_confidence" };
  }

  const threshold = clampThreshold(input.threshold);
  const verdict = input.classification.verdict;

  if (verdict === "kein_kunde" && confidence >= threshold) {
    return { action: "never", reason: "not_a_customer" };
  }

  const sureCustomer =
    verdict === "kundenanfrage" && confidence >= threshold && input.classification.evidenceInText;

  if (sureCustomer && input.autoWriteEnabled) {
    return { action: "auto", reason: "sure_customer" };
  }
  if (!input.suggestionsEnabled) {
    return { action: "never", reason: sureCustomer ? "auto_disabled" : "below_threshold" };
  }
  if (verdict === "kein_kunde") return { action: "suggest", reason: "uncertain_not_customer" };
  if (verdict === "unsicher") return { action: "suggest", reason: "uncertain" };
  if (!input.classification.evidenceInText) return { action: "suggest", reason: "evidence_not_in_text" };
  return { action: "suggest", reason: sureCustomer ? "auto_disabled" : "below_threshold" };
}
