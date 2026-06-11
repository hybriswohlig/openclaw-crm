/**
 * Leaf module (no dependency on the inbox send services, so the ingest hot path
 * can import it without an import cycle). Holds the decline/opt-out detection,
 * the per-person suppression list, and the deterministic price/commitment guard
 * shared by all three agent engines.
 */

import { db } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { agentSuppressions } from "@/db/schema/agent";
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
 * Deterministic opt-out line appended to every proactive (business-initiated)
 * agent message: the first-contact opener and every follow-up nudge. Du-form to
 * match the casual register. An objection is absolute (Art. 21 DSGVO), so the
 * wording must make declining trivial.
 */
export const OPT_OUT_LINE =
  "PS: Wenn du keine Nachrichten mehr von uns willst, antworte einfach mit STOP.";

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

/** True if this person (by canonical phone or email) has opted out of agent contact. */
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
  const [row] = await db
    .select({ id: agentSuppressions.id })
    .from(agentSuppressions)
    .where(
      and(
        eq(agentSuppressions.workspaceId, workspaceId),
        sql`${agentSuppressions.valueCanonical} = ANY(${keys})`
      )
    )
    .limit(1);
  return Boolean(row);
}
