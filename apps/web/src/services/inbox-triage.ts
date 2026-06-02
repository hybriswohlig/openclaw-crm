/**
 * Inbound lead/noise triage (KOT-IDENTITY Phase 6). Assigns a `lane` to a
 * conversation so marketing, newsletters, transactional notifications and
 * platform bots stay OUT of the lead inbox without being deleted.
 *
 * Pure + dependency-free → unit-testable and safe to call at ingest. Layers run
 * cheapest-first, stop at the first decisive verdict:
 *   0. Kleinanzeigen sub-rule (relay buyer inquiry = lead; platform notice = info)
 *   1. RFC bulk/automation headers (List-Unsubscribe, Precedence, Auto-Submitted…)
 *   2. sender deny list (no-reply / newsletter / ESP domains)
 *   3. light content heuristic (image/link/offer heavy → promotional)
 *   default: lead.
 * (Layer 4, an LLM on the ambiguous remainder, is intentionally not wired yet.)
 */

export type ConversationLane = "lead" | "info" | "spam" | "review";
export type ClassifiedBy = "header" | "senderlist" | "heuristic" | "llm" | "manual";

export interface ClassifyInput {
  /** header name (any case) -> value, e.g. Object.fromEntries(parsed.headers). */
  headers?: Record<string, unknown> | null;
  fromAddr?: string | null;
  subject?: string | null;
  body?: string | null;
}

export interface ClassifyResult {
  lane: ConversationLane;
  reason: string;
  by: ClassifiedBy;
}

const KA_DOMAIN_RE = /@(?:[a-z0-9.-]*\.)?kleinanzeigen\.de$/i;
const KA_RELAY_RE = /-ek-ek@mail\.kleinanzeigen\.de$/i;
const KA_BUYER_SUBJECT_RE = /nutzer-anfrage|anfrage zu deiner anzeige|nachricht von|antwort von/i;

const DENY_PREFIXES = ["no-reply", "noreply", "no_reply", "donotreply", "do-not-reply", "mailer-daemon", "bounce", "notification", "notifications", "mailing", "newsletter"];
const MARKETING_LOCALS = new Set(["newsletter", "marketing", "news", "promo", "promotions", "deals", "offers"]);
const ESP_DOMAINS = ["mailchimp", "sendgrid", "klaviyo", "hubspot", "sendinblue", "mailgun", "amazonses", "sparkpostmail", "mailjet", "constantcontact", "mailerlite"];

function headerVal(headers: Record<string, unknown> | null | undefined, name: string): string {
  if (!headers) return "";
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name) {
      const v = headers[k];
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        return typeof o.value === "string" ? o.value : JSON.stringify(v);
      }
      return v == null ? "" : String(v);
    }
  }
  return "";
}

export function classifyInbound(input: ClassifyInput): ClassifyResult {
  const from = (input.fromAddr ?? "").trim().toLowerCase();
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  const h = input.headers;

  // ── Layer 0: Kleinanzeigen ────────────────────────────────────────────────
  if (KA_DOMAIN_RE.test(from)) {
    if (KA_RELAY_RE.test(from) || KA_BUYER_SUBJECT_RE.test(subject)) {
      return { lane: "lead", reason: "Kleinanzeigen Kaeufer-Anfrage", by: "senderlist" };
    }
    return { lane: "info", reason: "Kleinanzeigen Plattform-Benachrichtigung", by: "senderlist" };
  }

  // ── Layer 1: RFC bulk/automation headers ──────────────────────────────────
  if (headerVal(h, "list-unsubscribe") || headerVal(h, "list-id")) {
    return { lane: "info", reason: "Massen-Mail (List-Unsubscribe/List-Id)", by: "header" };
  }
  const precedence = headerVal(h, "precedence").toLowerCase();
  if (["bulk", "list", "junk", "auto_reply"].includes(precedence)) {
    return { lane: "info", reason: `Precedence: ${precedence}`, by: "header" };
  }
  const autoSub = headerVal(h, "auto-submitted").toLowerCase();
  if (autoSub && autoSub !== "no") {
    return { lane: "info", reason: `Auto-Submitted: ${autoSub}`, by: "header" };
  }
  if (headerVal(h, "feedback-id")) {
    return { lane: "info", reason: "Feedback-ID (Bulk-Sender)", by: "header" };
  }
  if (/\b(DR|AutoReply|All)\b/i.test(headerVal(h, "x-auto-response-suppress"))) {
    return { lane: "info", reason: "X-Auto-Response-Suppress", by: "header" };
  }

  // ── Layer 2: sender deny list ─────────────────────────────────────────────
  const local = from.split("@")[0] ?? "";
  const domain = from.split("@")[1] ?? "";
  if (DENY_PREFIXES.some((p) => local.startsWith(p))) {
    return { lane: "info", reason: `Automatik-Absender (${local || from})`, by: "senderlist" };
  }
  if (MARKETING_LOCALS.has(local)) {
    return { lane: "info", reason: `Marketing-Absender (${local})`, by: "senderlist" };
  }
  if (domain && ESP_DOMAINS.some((d) => domain.includes(d))) {
    return { lane: "info", reason: `Newsletter-Dienst (${domain})`, by: "senderlist" };
  }

  // ── Layer 3: light content heuristic ──────────────────────────────────────
  const links = (body.match(/https?:\/\//g) ?? []).length;
  const offerish = /(rabatt|gutschein|sale|gewinnspiel|prozent|%\s|jetzt\s+(kaufen|sichern)|abmelden|unsubscribe|view in browser|im browser ansehen)/i.test(body);
  if (links >= 8 && offerish) {
    return { lane: "info", reason: "werblicher Inhalt (viele Links + Angebots-Wortwahl)", by: "heuristic" };
  }

  // ── default ───────────────────────────────────────────────────────────────
  return { lane: "lead", reason: "menschliche Anfrage (kein Noise-Signal)", by: "heuristic" };
}

// ─── Messaging (WhatsApp / SMS) body classification ───────────────────────────
// WhatsApp / SMS have no email headers, so we classify by body. Precision-biased:
// only one-time-codes / verification notifications go to Info (a real customer
// inquiry never contains an OTP). A brand-ish push name alone is NOT enough.
const OTP_RE = /(best[äa]tigungscode|verifizierungscode|sicherheitscode|verification code|security code|einmalpasswort|one[\s-]?time|\bOTP\b|\bcode\b[^\d]{0,20}\d{3,8}|\d{3,8}[^\d]{0,20}\bcode\b|code\s*(?:lautet|ist|:))/i;
const CODE6_RE = /(?<!\d)\d{3}[\s-]?\d{3}(?!\d)/;

export function classifyMessagingBody(body: string | null | undefined, displayName?: string | null): ClassifyResult {
  const b = body ?? "";
  if (OTP_RE.test(b)) return { lane: "info", reason: "Verifizierungscode / OTP", by: "heuristic" };
  const name = (displayName ?? "").toLowerCase();
  if (/\b(facebook|instagram|whatsapp|telegram|google|microsoft|paypal|amazon|tiktok|netflix|twitter|linkedin|apple)\b/.test(name) && CODE6_RE.test(b)) {
    return { lane: "info", reason: "Plattform-Benachrichtigung", by: "senderlist" };
  }
  return { lane: "lead", reason: "Nachricht (kein Noise-Signal)", by: "heuristic" };
}
