/**
 * Canonicalization layer for the identity graph (KOT-IDENTITY).
 *
 * Pure and dependency-light (only libphonenumber-js). Every function NEVER
 * throws, so it is safe to call inline on the ingest hot path. No DB imports.
 *
 * These functions produce the `value_canonical` keys that person_identifiers
 * and inbox_contacts.{phone,email}_canonical are matched on, and that drive the
 * D1 deterministic auto-merge. Equal humans must produce equal canonical keys:
 *   "+49 151 5905 8963"  "0151 5905 8963"  "0049 151 59058963"  ->  "+4915159058963"
 *   "Max@Example.COM "  ->  "max@example.com"
 */

import { parsePhoneNumberFromString } from "libphonenumber-js/core";
import type { CountryCode } from "libphonenumber-js";
// Metadata is imported separately so we control the ESM/CJS interop: under
// esbuild/tsx the JSON module arrives wrapped as `{ default }`, while
// webpack/turbopack hand it over directly. Normalizing both shapes here makes
// canonicalizePhone work in EVERY runtime (Next.js, vitest, node/tsx); the main
// "libphonenumber-js" entry breaks under tsx because its bundled metadata import
// resolves to `{ default }`.
import phoneMetadataRaw from "libphonenumber-js/min/metadata";
const PHONE_METADATA = (
  (phoneMetadataRaw as { countries?: unknown }).countries
    ? phoneMetadataRaw
    : (phoneMetadataRaw as unknown as { default: unknown }).default
) as Parameters<typeof parsePhoneNumberFromString>[2];
// Mobile-only metadata: a number that validates against it is a mobile number.
// (The min metadata has no type patterns, so it cannot tell mobile from fixed.)
import phoneMobileMetadataRaw from "libphonenumber-js/mobile/metadata";
const PHONE_MOBILE_METADATA = (
  (phoneMobileMetadataRaw as { countries?: unknown }).countries
    ? phoneMobileMetadataRaw
    : (phoneMobileMetadataRaw as unknown as { default: unknown }).default
) as Parameters<typeof parsePhoneNumberFromString>[2];

/** Parse with explicit metadata; never throws (the contract for this module). */
function parsePhone(s: string, region: CountryCode) {
  try {
    return parsePhoneNumberFromString(s, region, PHONE_METADATA) ?? null;
  } catch {
    return null;
  }
}

// ─── Kleinanzeigen relay detection ────────────────────────────────────────────
// KEEP IN SYNC with apps/web/src/services/inbox-kleinanzeigen.ts:9-10. A relay
// address (xxxx-<40hex>-ek-ek@mail.kleinanzeigen.de) rotates per ad and is NOT
// the person's mailbox, so it must never become a hard `email` identity key.
const KA_RELAY_RE = /^[a-z0-9]+-[a-f0-9]{40,}-ek-ek@mail\.kleinanzeigen\.de$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isRelayEmail(addr: string | null | undefined): boolean {
  if (!addr) return false;
  return KA_RELAY_RE.test(addr.trim());
}

// ─── JID classification (WhatsApp / Baileys) ──────────────────────────────────
export type JidKind = "phone" | "wa_lid" | "group" | "unknown";

export interface JidParts {
  kind: JidKind;
  /** The local part before "@" with any device suffix (":4") stripped. */
  local: string;
  /** Canonical E.164 if this JID is a real phone, else null. */
  phoneE164: string | null;
}

/**
 * Classify a Baileys / WhatsApp JID.
 *   "4917...@s.whatsapp.net"      -> phone   (a dialable number)
 *   "4917...@c.us"               -> phone
 *   "12345678901234@lid"          -> wa_lid  (a LID, NOT a phone — never key on it)
 *   "12036...-1602...@g.us"       -> group   (a group thread, NEVER a person)
 *   "4917..."                     -> phone   (bare number, no domain)
 */
export function classifyJid(jid: string | null | undefined, defaultRegion: CountryCode = "DE"): JidParts {
  if (!jid) return { kind: "unknown", local: "", phoneE164: null };
  const trimmed = jid.trim();
  const at = trimmed.indexOf("@");
  const domain = at >= 0 ? trimmed.slice(at + 1).toLowerCase() : "";
  // Strip device suffix ("123:4@...") from the local part.
  const local = (at >= 0 ? trimmed.slice(0, at) : trimmed).replace(/:\d+$/, "");

  if (domain.startsWith("g.us")) return { kind: "group", local, phoneE164: null };
  if (domain.startsWith("lid")) return { kind: "wa_lid", local, phoneE164: null };

  // s.whatsapp.net / c.us / bare number -> treat the local part as a phone.
  const phoneE164 = canonicalizePhone(local, defaultRegion);
  if (phoneE164) return { kind: "phone", local, phoneE164 };
  return { kind: "unknown", local, phoneE164: null };
}

// ─── Phone ────────────────────────────────────────────────────────────────────
/**
 * Canonicalize a raw phone string to E.164 ("+49151..."). Returns null for
 * empty input, non-dialable junk, WhatsApp @lid / @g.us JIDs, and anything
 * libphonenumber rejects as invalid for the inferred region.
 *
 * Replaces normalizeWaPhone for IDENTITY keying. (normalizeWaPhone stays only
 * as the Meta wire-format helper: digits-only for the Graph API send call.)
 */
export function canonicalizePhone(raw: string | null | undefined, defaultRegion: CountryCode = "DE"): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // A "@lid" or "@g.us" JID is not a phone; bail before parsing.
  const at = s.indexOf("@");
  if (at >= 0) {
    const domain = s.slice(at + 1).toLowerCase();
    if (domain.startsWith("lid") || domain.startsWith("g.us")) return null;
    s = s.slice(0, at).replace(/:\d+$/, ""); // drop device suffix "123:4@..."
  }

  // Reduce to digits and a single leading "+", so the prefix logic is robust to
  // spaces / parens / dashes in the raw input.
  const compact = s.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (!compact) return null;

  // Pick the right interpretation. The hard case is the WhatsApp wa_id, which is
  // the full international number WITHOUT a "+" (e.g. "4915159058963"); parsing
  // that against a national region fails, so we prepend "+" for bare
  // international-looking digit runs. A leading 0 means national (region);
  // "00" / "+" are explicit international.
  let phone = null as ReturnType<typeof parsePhone>;
  if (compact.startsWith("+")) {
    phone = parsePhone(compact, defaultRegion);
  } else if (compact.startsWith("00")) {
    phone = parsePhone("+" + compact.slice(2), defaultRegion);
  } else if (compact.startsWith("0")) {
    phone = parsePhone(compact, defaultRegion); // national
  } else if (/^\d{8,15}$/.test(compact)) {
    // Bare international digits (WhatsApp wa_id). Prefer the "+"-prefixed reading;
    // fall back to a national reading if that is invalid.
    phone = parsePhone("+" + compact, defaultRegion);
    if (!phone || !phone.isValid()) {
      phone = parsePhone(compact, defaultRegion);
    }
  } else {
    phone = parsePhone(compact, defaultRegion);
  }

  if (!phone || !phone.isValid()) return null;
  return phone.number; // E.164
}

// ─── Line type (mobile vs landline) ──────────────────────────────────────────
export type PhoneLineType = "mobile" | "landline" | "unknown";

/**
 * Classify an E.164 number as mobile vs landline. Drives the first-contact
 * channel decision: WhatsApp only goes to mobiles; landlines get a call task.
 * Never throws.
 *
 * Order of evidence:
 *  1. valid against the mobile-only metadata -> mobile (works worldwide; in
 *     countries where fixed and mobile share patterns, e.g. US, everything
 *     passes as mobile, which errs on the permissive side),
 *  2. German prefix fallback (15x/16x/17x is the complete DE mobile space),
 *  3. valid full number that failed the mobile check -> landline,
 *  4. otherwise unknown (caller decides; first contact treats it like mobile).
 */
export function classifyPhoneLineType(e164: string | null | undefined): PhoneLineType {
  if (!e164 || !/^\+\d{6,15}$/.test(e164)) return "unknown";
  // The input is E.164 (leading +), so the default region never kicks in; "DE"
  // just satisfies the signature, matching the rest of this module.
  try {
    const mobile = parsePhoneNumberFromString(e164, "DE", PHONE_MOBILE_METADATA);
    if (mobile?.isValid()) return "mobile";
  } catch {
    // fall through to the prefix heuristic
  }
  const de = e164.match(/^\+49(\d+)$/);
  if (de) return /^(15|16|17)/.test(de[1]) ? "mobile" : "landline";
  try {
    const full = parsePhoneNumberFromString(e164, "DE", PHONE_METADATA);
    if (full?.isValid()) return "landline";
  } catch {
    // ignore
  }
  return "unknown";
}

// ─── Email ────────────────────────────────────────────────────────────────────
/**
 * Lowercase + trim an email. Returns null for malformed addresses OR relay
 * addresses (a Kleinanzeigen rotating relay must never become a hard key).
 */
export function canonicalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  if (isRelayEmail(e)) return null;
  return e;
}

// ─── Phone extraction from free text ──────────────────────────────────────────
/**
 * Pull every dialable phone out of a body. Used for:
 *  - the Kleinanzeigen "(Tel.: 0151 ...)" line the parser currently discards, and
 *  - operator-pasted numbers inside a KA / email / WhatsApp thread.
 * Returns a DEDUPED E.164 list (first-seen order). Empty on no hits.
 */
export function extractPhonesFromText(body: string | null | undefined, defaultRegion: CountryCode = "DE"): string[] {
  if (!body) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // Candidate runs: +49..., 0049..., 0151..., grouped with spaces / ( ) / - / .
  const CAND = /(?:\+|00)?\d[\d\s().\-/]{6,20}\d/g;
  for (const m of String(body).matchAll(CAND)) {
    const canon = canonicalizePhone(m[0], defaultRegion);
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}
