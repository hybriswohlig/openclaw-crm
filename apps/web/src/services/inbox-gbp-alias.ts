/**
 * GBP→OpenCRM email-forward bridge helpers (KOT-654).
 *
 * The shared inbox `inbound@darioushkottke.online` accepts mail forwarded
 * from Dario's GBP surfaces (Local Services Ads, GBP messaging, call-tracking
 * emails). The mail-provider catch-all preserves the original recipient
 * local-part in `Delivered-To` / `X-Original-To`. We use that to tag each
 * resulting deal with the right `lead_source`.
 */

import type { ParsedMail } from "mailparser";

/** Channel-account address that routes through the GBP-bridge alias logic. */
export const SHARED_INBOUND_ADDRESS_PREFIX = "inbound@";

/**
 * Result of inspecting a parsed inbound email for a GBP alias.
 *
 * - `matched`: a known alias (`gbp-kottke` / `gbp-ceylan`) was detected. Use
 *   `leadSource` to stamp the resulting deal and skip the default branch.
 * - `fellThrough`: the email arrived on the shared inbound mailbox but no
 *   alias matched. The handler should emit a WARN log so a misconfigured
 *   forwarding rule shows up early — without this signal, broken forwards
 *   look indistinguishable from legitimate `WhatsApp / Website` traffic.
 * - `null`: the email did not arrive on the shared mailbox at all (e.g.
 *   Kleinanzeigen, a dedicated channel account). Skip alias logic entirely.
 */
export type GbpAliasResult =
  | { kind: "matched"; leadSource: "GBP-Kottke" | "GBP-Ceylan"; localPart: string }
  | {
      kind: "fellThrough";
      deliveredTo: string | null;
      xOriginalTo: string | null;
      toAddress: string | null;
    }
  | null;

/** Lower-case local-part of an `addr@host` string (or null). */
function localPartOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.indexOf("@");
  if (at <= 0) return null;
  return address.slice(0, at).toLowerCase();
}

/** Read a header value from a mailparser ParsedMail.headers Map (case-insensitive). */
function readHeader(parsed: ParsedMail, name: string): string | null {
  const lower = name.toLowerCase();
  const headers = parsed.headers as Map<string, unknown> | undefined;
  if (!headers || typeof headers.get !== "function") return null;
  const raw = headers.get(lower);
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

/** Pull the bare email address out of a `Delivered-To`-style header value. */
function addressOnly(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/[\w.+-]+@[\w.-]+/);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Decide whether an inbound message routes through the GBP-bridge alias path.
 *
 * Returns `null` when the email did not arrive on the shared inbound mailbox.
 * Otherwise returns either a matched alias or a fall-through descriptor with
 * the raw header values for logging.
 */
export function detectGbpAlias(parsed: ParsedMail, channelAccountAddress: string): GbpAliasResult {
  const accountAddr = channelAccountAddress.toLowerCase();
  const isSharedInbox = accountAddr.startsWith(SHARED_INBOUND_ADDRESS_PREFIX);
  if (!isSharedInbox) return null;

  const deliveredTo = readHeader(parsed, "delivered-to");
  const xOriginalTo = readHeader(parsed, "x-original-to");

  // Prefer Delivered-To (set by the receiving server when a forward fans into
  // the shared inbox), then X-Original-To, then the To header as a last-resort
  // fallback in case the forward provider strips both Delivered-To variants.
  const toFirst = (() => {
    const to = parsed.to;
    if (!to) return null;
    const list = Array.isArray(to) ? to : [to];
    return list[0]?.value?.[0]?.address ?? null;
  })();
  const toAddress = toFirst ? toFirst.toLowerCase() : null;

  const candidates = [addressOnly(deliveredTo), addressOnly(xOriginalTo), toAddress];

  for (const cand of candidates) {
    const lp = localPartOf(cand);
    if (lp === "gbp-kottke") return { kind: "matched", leadSource: "GBP-Kottke", localPart: lp };
    if (lp === "gbp-ceylan") return { kind: "matched", leadSource: "GBP-Ceylan", localPart: lp };
  }

  return {
    kind: "fellThrough",
    deliveredTo,
    xOriginalTo,
    toAddress,
  };
}

// ─── Forward-wrapper stripping ───────────────────────────────────────────────

const FORWARD_HEADER_PATTERNS: RegExp[] = [
  // Gmail / generic English: "---------- Forwarded message ----------"
  /^[ \t]*-{2,}[ \t]*Forwarded message[ \t]*-{2,}[ \t]*$/im,
  // Apple Mail / iOS: "Begin forwarded message:"
  /^[ \t]*Begin forwarded message:[ \t]*$/im,
  // German Outlook / web mail: "Von: <sender> Gesendet: …" header block
  /^[ \t]*Von:[ \t].+(?:\r?\n.+)*?\r?\n[ \t]*Gesendet:[ \t]/im,
];

/**
 * Strip the forward-wrapper header off a forwarded mail body so the activity
 * feed shows the customer's words, not the mail-client envelope.
 *
 * Conservative: if no known wrapper matches we return the body unchanged so
 * a stray pattern never eats real content. Drafts that include the original
 * inline below the wrapper are kept (the customer's quote is part of the
 * conversation context).
 */
export function stripForwardWrapper(body: string): string {
  if (!body) return body;
  let earliest = -1;
  for (const re of FORWARD_HEADER_PATTERNS) {
    const m = re.exec(body);
    if (m && m.index !== undefined) {
      if (earliest < 0 || m.index < earliest) earliest = m.index;
    }
  }
  if (earliest < 0) return body;
  // Skip the wrapper line itself + any blank lines, and resume at the first
  // non-empty line of the original content.
  const after = body.slice(earliest);
  const eol = after.indexOf("\n");
  if (eol < 0) return body;
  let rest = after.slice(eol + 1);
  // Skip subsequent header-ish lines (From:/Date:/Subject:/To: variants in
  // English + German) and any trailing blank lines so the result starts at
  // the customer's actual prose.
  const HEADER_LINE = /^[ \t]*(From|Sender|To|Cc|Date|Subject|Reply-To|Von|An|Cc|Datum|Betreff|Gesendet|Antwort an):[^\r\n]*\r?\n?/i;
  while (true) {
    const m = HEADER_LINE.exec(rest);
    if (!m || m.index !== 0) break;
    rest = rest.slice(m[0].length);
  }
  return rest.replace(/^\s*\r?\n+/, "").trimEnd();
}
