// Negative-experience valve for the post-move reviews engine.
//
// Two scans, same matching rules:
//   - scanInternalNotes runs against the crew's internal_quality_notes
//     before any send. Used by the cron job (KOT-622) to short-circuit
//     and route via Template C without touching the public review link.
//   - scanCustomerReply runs against inbound SMS/WhatsApp replies tied
//     to a review-request thread. Used by the inbound complaint
//     scanner (KOT-623).
//
// Matching: Unicode-NFKD normalize + strip combining marks (so
// "verspätet" and "verspaetet" both match), lower-case, then plain
// substring match on the whole string. Conservative by design — CEO
// priority on KOT-603 is "false negatives are not acceptable; false
// positives route to my inbox, which is fine."
//
// Keywords are lifted verbatim from spec §6.1 and §6.2 of the
// post-move reviews engine spec on KOT-596.

export const INTERNAL_RED_FLAG_KEYWORDS: readonly string[] = [
  "beschädigt",
  "kaputt",
  "kratz",
  "defekt",
  "verspätet",
  "zu spät",
  "unzufrieden",
  "beschwerde",
  "problem",
  "ärger",
  "schlecht",
  "nicht zufrieden",
  "fehler",
  "verloren",
  "vergessen",
  "unhöflich",
  "unfreundlich",
  "streit",
] as const;

export const CUSTOMER_REPLY_RED_FLAG_KEYWORDS: readonly string[] = [
  "beschädigt",
  "kaputt",
  "kratzer",
  "defekt",
  "fehlt",
  "fehlen",
  "verloren",
  "vergessen",
  "zu spät",
  "verspätet",
  "geld zurück",
  "erstattung",
  "rückerstattung",
  "beschwerde",
  "schlecht",
  "mies",
  "enttäuscht",
  "ärger",
  "streit",
  "unhöflich",
  "unfreundlich",
  "unzufrieden",
  "problem",
  "anwalt",
  "rechtlich",
  "klage",
  "anzeige",
] as const;

export interface ValveResult {
  matched: boolean;
  hits: string[];
}

function normalize(raw: string): string {
  // German users without an umlaut keyboard routinely type "ae/oe/ue/ss"
  // for "ä/ö/ü/ß" — both spellings must hit the same keyword. We expand
  // the digraphs BEFORE NFKD so "verspätet" and "verspaetet" both end
  // up as "verspaetet". After expansion, NFKD + combining-mark strip
  // handles any remaining Latin accents (French, Turkish, etc.).
  return raw
    .replace(/ä/g, "ae").replace(/Ä/g, "Ae")
    .replace(/ö/g, "oe").replace(/Ö/g, "Oe")
    .replace(/ü/g, "ue").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function scan(text: string | null | undefined, keywords: readonly string[]): ValveResult {
  if (!text) return { matched: false, hits: [] };
  const haystack = normalize(text);
  const hits: string[] = [];
  for (const kw of keywords) {
    if (haystack.includes(normalize(kw))) hits.push(kw);
  }
  return { matched: hits.length > 0, hits };
}

export function scanInternalNotes(text: string | null | undefined): ValveResult {
  return scan(text, INTERNAL_RED_FLAG_KEYWORDS);
}

export function scanCustomerReply(text: string | null | undefined): ValveResult {
  return scan(text, CUSTOMER_REPLY_RED_FLAG_KEYWORDS);
}

// Template C — service recovery, no public review link. Sent both
// pre-emptively when the internal valve fires AND as auto-response
// when the inbound valve fires. Spec §6.3.
export function templateCDe(firstName: string): string {
  return [
    `Hallo ${firstName},`,
    `das tut uns leid zu hören. Bitte schreiben Sie uns hier kurz, was nicht passt – wir melden uns innerhalb von 24 Stunden persönlich bei Ihnen, und Darioush schaut sich das Ganze selbst an.`,
    `Danke, dass Sie uns die Chance geben, das geradezurücken.`,
    `Kottke Umzüge`,
  ].join("\n");
}
