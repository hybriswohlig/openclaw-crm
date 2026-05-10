/**
 * Pure helpers for Kleinanzeigen email parsing.
 *
 * Kept dependency-free (no IMAP/SMTP imports) so it can be used both at
 * ingest time (inbox-email.ts) and at render time (inbox.ts getMessages),
 * including to re-clean already-stored messages from their saved bodyHtml.
 */

const KLEINANZEIGEN_RELAY_RE =
  /^[a-z0-9]+-[a-f0-9]{40,}-ek-ek@mail\.kleinanzeigen\.de$/i;
const KLEINANZEIGEN_SUBJECT_RE = /nutzer-anfrage|anfrage zu deiner anzeige/i;

export function isKleinanzeigenEmail(from: string, subject: string): boolean {
  return (
    KLEINANZEIGEN_RELAY_RE.test(from) || KLEINANZEIGEN_SUBJECT_RE.test(subject)
  );
}

/** "RamonaOstd über Kleinanzeigen" → "RamonaOstd". */
export function stripKleinanzeigenSuffix(name: string): string {
  return name.replace(/\s*(?:über|ueber|via)\s+Kleinanzeigen\s*$/i, "").trim();
}

/** Strip HTML tags and decode common entities. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&Ouml;/gi, "Ö")
    .replace(/&Uuml;/gi, "Ü")
    .replace(/&szlig;/gi, "ß")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse Kleinanzeigen notification body to extract just the customer message.
 *
 * Kleinanzeigen wraps the actual user text inside a grey <td> block that
 * starts with "<b>Nachricht von</b> NAME (Tel.: ...)" (new inquiry) or
 * "<b>Antwort von</b> NAME" (reply in same thread). We locate that block,
 * drop the header line, and return only the message — everything else
 * (ad link, "Beantworte diese Nachricht", security tips, footer) is dropped.
 */
export function parseKleinanzeigenBody(
  text: string,
  html?: string | null
): string {
  let workingHtml = html ?? "";

  // Strip any quoted reply chain — we only want the newest Kleinanzeigen block.
  workingHtml = workingHtml.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");

  // Find the <td> that contains the message block.
  const blockRe =
    /<td[^>]*>([\s\S]*?(?:Nachricht|Antwort)\s+von[\s\S]*?)<\/td>/i;
  const blockMatch = workingHtml.match(blockRe);

  if (blockMatch) {
    const plain = htmlToPlain(blockMatch[1]);
    const cleaned = plain
      .replace(
        /^[\s\S]*?(?:Nachricht|Antwort)\s+von[^\n]*\n(?:\s*\(Tel\.?:[^\n]*\)\s*\n)?/i,
        ""
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cleaned) return cleaned;
  }

  // Fallback: strip known footer phrases from whatever we have.
  const source = workingHtml ? htmlToPlain(workingHtml) : text;
  let body = source.replace(/\r\n/g, "\n").trim();
  const endPatterns = [
    /\n\s*Beantworte diese Nachricht/i,
    /\n\s*Schütze dich vor Betrug/i,
    /\n\s*Zum Schutz unserer Nutzer/i,
    /\n\s*Dein Team von Kleinanzeigen/i,
    /\n\s*(?:Impressum|Datenschutzerklärung|Nutzungsbedingungen)/i,
  ];
  for (const re of endPatterns) {
    const m = body.match(re);
    if (m && m.index !== undefined) body = body.slice(0, m.index);
  }
  return body.replace(/\n{3,}/g, "\n\n").trim() || text.trim();
}

/**
 * Extract the variant tag from a Kleinanzeigen email's subject or body.
 *
 * Convention (KOT-607): each ad title is prefixed with `[variant|stadtteil|brand]`
 * - e.g. `[K1|Bogenhausen|Kottke] Moebeltransport Muenchen`. The notification
 * mail copies the ad title into the subject, so the tag is usually right
 * there; we fall back to the body in case Kleinanzeigen reformats the subject.
 *
 * Returns the inner `variant|stadtteil|brand` string, or `null` if no tag is
 * present (Sales Outreach can fill `lead_subsource` manually for legacy ads).
 */
const KLEINANZEIGEN_SUBSOURCE_RE = /\[([^|\]\s][^|\]]*)\|([^|\]]+)\|([^\]]+)\]/;

export function extractKleinanzeigenSubsource(
  subject: string,
  body: string
): string | null {
  const haystacks = [subject ?? "", body ?? ""];
  for (const h of haystacks) {
    const m = h.match(KLEINANZEIGEN_SUBSOURCE_RE);
    if (m) {
      const variant = m[1].trim();
      const stadtteil = m[2].trim();
      const brand = m[3].trim();
      if (variant && stadtteil && brand) {
        return `${variant}|${stadtteil}|${brand}`;
      }
    }
  }
  return null;
}
