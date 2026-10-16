/**
 * Leaf module (no dependency on the inbox send services, so the ingest hot path
 * can import it without an import cycle). Holds the decline/opt-out detection,
 * the per-person suppression list, and the deterministic price/commitment guard
 * shared by all three agent engines.
 */

import { db } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { agentSuppressions, dealAgentState } from "@/db/schema/agent";
import { inboxConversations } from "@/db/schema/inbox";
import { canonicalizePhone, canonicalizeEmail } from "@/lib/identity/canonical";

// Conservative: only clear, unambiguous declines, to avoid silencing real leads.
// Includes opt-out keywords (STOP etc.): an advertising objection under Art. 21
// DSGVO / §7 UWG is absolute, so the agent must fall silent immediately.
const DECLINE_PATTERNS =
  /(kein interesse|zu teuer|doch nicht|anderweitig|anderen anbieter|bereits (beauftragt|gebucht|vergeben|organisiert)|schon (beauftragt|gebucht|jemanden)|abgesagt|hat sich erledigt|erledigt sich|brauche (keine|nichts|nicht mehr)|nicht mehr (nötig|notwendig|relevant|aktuell|gebraucht)|keine (weiteren )?nachrichten|nicht mehr (schreiben|kontaktieren)|^\s*stopp?\s*[.!]?\s*$|abbestellen|abmelden)/i;

/** Heuristic safety net: does the customer's last message clearly decline / opt out? */
export function looksDeclined(text: string | null | undefined): boolean {
  if (!text) return false;
  return DECLINE_PATTERNS.test(text);
}

// ─── Price / commitment guard (deterministic, shared by all engines) ─────────
/**
 * A price the agent must never name itself. Matches "800 Euro", "1.200 €",
 * "ca. 90 EUR", "1200€". The human always makes the offer, so any number
 * followed by a currency in a generated message means the model overstepped.
 * Note: "€" needs no trailing word boundary (it is a non-word char, so "1200€"
 * at end of string would fail "€\b"); "eur"/"euro" keep the boundary so a stray
 * "Europa" never trips it.
 */
export const PRICE_RE = /\d{1,3}(?:[.\s]?\d{3})*\s?(?:€|eur(?:o)?\b)/i;
/**
 * A binding commitment the agent must never make (booking/holding a date or
 * slot). Deliberately narrow: ASKING about a date is fine, CONFIRMING/booking
 * one is not. So this matches the commitment verbs, not a bare date mention.
 */
export const COMMITMENT_RE =
  /\b(gebucht|fest gebucht|reserviert|zugesagt|garantiert|fix eingeplant|eingeplant für|geblockt für|haben (wir )?(den )?termin)\b/i;

/** True if a generated customer message names a price or makes a booking commitment. */
export function leaksPriceOrCommitment(text: string | null | undefined): boolean {
  if (!text) return false;
  return PRICE_RE.test(text) || COMMITMENT_RE.test(text);
}

// ─── Opt-out line (shared) ───────────────────────────────────────────────────
/**
 * Deterministic opt-out line for proactive (business-initiated) agent messages:
 * the first-contact opener and every follow-up nudge. An objection is absolute
 * (Art. 21 DSGVO), so the wording must make declining trivial. The line follows
 * the message's form of address; when that is unclear it stays Sie.
 * OPT_OUT_LINE remains the Du wording for existing imports. Append via
 * mitOptOutZeile so the form and the duplicate check stay in one place.
 */
export const OPT_OUT_LINE_DU =
  "PS: Wenn du keine Nachrichten mehr von uns willst, antworte einfach mit STOP.";
export const OPT_OUT_LINE_SIE =
  "PS: Wenn Sie keine Nachrichten mehr von uns wünschen, antworten Sie einfach mit STOP.";
export const OPT_OUT_LINE = OPT_OUT_LINE_DU;

export type AnredeForm = "du" | "sie";

/** Stored form of address, when a conversation or deal has one. */
export interface OptOutAnredeQuellen {
  konversation?: string | null;
  deal?: string | null;
}

export function normalisiereAnrede(wert: unknown): AnredeForm | null {
  if (typeof wert !== "string") return null;
  const v = wert.trim().toLowerCase();
  if (v === "du" || v === "sie") return v;
  return null;
}

// Du: the pronouns the user named (du/dir/dein and their inflections) plus the
// 2nd-person verbs and plural "ihr könnt". A bare lowercase "ihr" is not enough
// ("ich helfe ihr" is third person).
const DU_PRONOMEN =
  /\b(du|dich|dir|dein(?:e(?:n|m|r|s)?)?|deins|euch|euer|eure(?:n|m|r|s)?)\b/i;
const DU_VERB = /\b(kannst|könnt|habt|seid|wollt|hast|bist|willst|musst|dürft|sollt|müsst)\b/i;
const IHR_DU = /\bihr\s+(?:könnt|habt|seid|wollt|dürft|sollt|müsst|wisst)\b/i;

// Sie: capital (or all-caps) Sie/Ihnen/Ihr. Sentence-initial "Sie sind …" is
// "they", not an address, so a bare "Sie" only counts mid-sentence or in a
// verb-first question ("Können Sie"). "Ihr Angebot" is formal, including at
// the start of a sentence; "Ihr könnt" is the informal plural.
const SIE_IHNEN = /\b(?:Ihnen|IHNEN)\b/;
const SIE_MITTE = /(?:[^.!?\n]\s)(?:Sie|SIE)\b/;
const SIE_FRAGE =
  /^(?:Können|Könnten|Haben|Sind|Würden|Wären|Hätten|Möchten|Dürfen|Sollen|Werden|Wollen)\s+(?:Sie|SIE)\b/m;
const SIE_IHR =
  /\b(?:Ihr(?:e(?:m|n|r|s)?|es)?|IHRE(?:M|N|R|S)?|IHR)\b(?!\s+(?:könnt|habt|seid|wollt|dürft|sollt|müsst|wisst|KÖNNT|HABT|SEID|WOLLT|DÜRFT|SOLLT|MÜSST|WISST)\b)/;

function hatDu(text: string): boolean {
  return DU_PRONOMEN.test(text) || DU_VERB.test(text) || IHR_DU.test(text);
}

function hatSie(text: string): boolean {
  return SIE_IHNEN.test(text) || SIE_MITTE.test(text) || SIE_FRAGE.test(text) || SIE_IHR.test(text);
}

/**
 * Form of address in one message. Null when the text has no clear signal
 * (then the caller falls back to a stored setting, and finally to Sie).
 * Both signals at once count as doubt and resolve to Sie.
 */
export function erkenneAnrede(text: string | null | undefined): AnredeForm | null {
  if (!text) return null;
  const sie = hatSie(text);
  const du = hatDu(text);
  if (sie && du) return "sie";
  if (sie) return "sie";
  if (du) return "du";
  return null;
}

/** Text signal wins. Otherwise a stored conversation or deal form. Conflict or silence → Sie. */
export function anredeFuerOptOut(text: string, quellen?: OptOutAnredeQuellen | null): AnredeForm {
  const ausText = erkenneAnrede(text);
  if (ausText) return ausText;
  const konv = normalisiereAnrede(quellen?.konversation);
  const deal = normalisiereAnrede(quellen?.deal);
  if (konv && deal && konv !== deal) return "sie";
  return konv ?? deal ?? "sie";
}

export function optOutZeile(anrede: AnredeForm): string {
  return anrede === "du" ? OPT_OUT_LINE_DU : OPT_OUT_LINE_SIE;
}

/** A STOP hint is the word STOP/STOPP, not a substring such as "Stopover". */
export function textHatStopHinweis(text: string): boolean {
  return /\bstop+\b/i.test(text);
}

/**
 * Append the opt-out line in the matching form. Does nothing when the text
 * already contains a STOP hint, so the line is never doubled. Callers decide
 * whether a footer is required at all (proactive class + opt-out setting).
 */
export function mitOptOutZeile(text: string, quellen?: OptOutAnredeQuellen | null): string {
  if (textHatStopHinweis(text)) return text;
  const basis = text.replace(/\s+$/u, "");
  if (!basis.trim()) return text;
  return `${basis}\n\n${optOutZeile(anredeFuerOptOut(basis, quellen))}`;
}

function registerAusAgentState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const register = (state as { register?: unknown }).register;
  return typeof register === "string" ? register : null;
}

/**
 * Stored form of address, if one was saved. Deal: deal_agent_state.register.
 * Conversation: inbox agent_state.register. Missing rows and DB errors yield
 * empty sources (the footer then follows the text, or Sie).
 */
export async function ladeGespeicherteAnrede(input: {
  dealRecordId?: string | null;
  conversationId?: string | null;
}): Promise<OptOutAnredeQuellen> {
  try {
    const [deal, conv] = await Promise.all([
      input.dealRecordId
        ? db
            .select({ register: dealAgentState.register })
            .from(dealAgentState)
            .where(eq(dealAgentState.dealRecordId, input.dealRecordId))
            .limit(1)
        : Promise.resolve([]),
      input.conversationId
        ? db
            .select({ agentState: inboxConversations.agentState })
            .from(inboxConversations)
            .where(eq(inboxConversations.id, input.conversationId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    return {
      deal: deal[0]?.register ?? null,
      konversation: registerAusAgentState(conv[0]?.agentState),
    };
  } catch (err) {
    console.error("[agent-suppress] ladeGespeicherteAnrede failed (footer falls back to the text):", err);
    return {};
  }
}

// ─── Per-person suppression list (opt-out across all engines) ────────────────
/**
 * Record a customer opt-out: writes the canonical phone and/or email into the
 * suppression list (idempotent). Called when a STOP/decline is detected at
 * ingest, so the opt-out is captured regardless of which engine is enabled.
 * Never throws (ingest hot path).
 */
export async function recordAgentDecline(
  workspaceId: string,
  input: {
    phone?: string | null;
    email?: string | null;
    conversationId?: string | null;
    reason?: string;
  }
): Promise<void> {
  try {
    const rows: Array<{ kind: string; valueCanonical: string }> = [];
    const phone = canonicalizePhone(input.phone, "DE");
    if (phone) rows.push({ kind: "phone", valueCanonical: phone });
    const email = canonicalizeEmail(input.email);
    if (email) rows.push({ kind: "email", valueCanonical: email });
    if (rows.length === 0) return;
    for (const r of rows) {
      await db
        .insert(agentSuppressions)
        .values({
          workspaceId,
          kind: r.kind,
          valueCanonical: r.valueCanonical,
          reason: input.reason ?? "customer_stop",
          sourceConversationId: input.conversationId ?? null,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    console.error("[agent-suppress] recordAgentDecline failed (non-blocking):", err);
  }
}

/**
 * True if this person (by canonical phone or email) has opted out of agent
 * contact. FAIL-SAFE: any DB error (e.g. the migration that creates the table is
 * not applied yet) returns false ("not suppressed, proceed") and logs a warning,
 * rather than throwing. A suppression-list hiccup must never silently block all
 * outreach — the worst case is we contact someone we should have skipped, which
 * the inbound STOP detection then catches on their reply.
 */
export async function isAgentSuppressed(
  workspaceId: string,
  input: { phone?: string | null; email?: string | null }
): Promise<boolean> {
  const phone = canonicalizePhone(input.phone, "DE");
  const email = canonicalizeEmail(input.email);
  const keys: string[] = [];
  if (phone) keys.push(phone);
  if (email) keys.push(email);
  if (keys.length === 0) return false;
  try {
    const [row] = await db
      .select({ id: agentSuppressions.id })
      .from(agentSuppressions)
      .where(
        and(
          eq(agentSuppressions.workspaceId, workspaceId),
          // inArray builds an IN (...) with one bound param per value. The raw
          // `= ANY(${keys})` form serialized the JS array as a single text param
          // ("malformed array literal"), which the fail-safe then swallowed.
          inArray(agentSuppressions.valueCanonical, keys)
        )
      )
      .limit(1);
    return Boolean(row);
  } catch (err) {
    console.error(
      "[agent-suppress] isAgentSuppressed failed (treating as NOT suppressed; is migration 0036 applied?):",
      err
    );
    return false;
  }
}
