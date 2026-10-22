/**
 * Möbeltransport24 portal leads.
 *
 * A collective sender (often noreply@…) with subject "Angebotsanfrage 12345".
 * The customer lives in the body, not in the From header. Pure and
 * dependency-free so ingest and the backfill share one parser.
 *
 * Real inbox_messages were not readable from this environment. The parser
 * accepts the labeled layouts those mails use (inline "Label: value", blocks
 * under Von/Nach, and Anfrage-Nr in the body). See the fixtures in the test.
 */

const BRAND_RE = /m(?:ö|oe|o)beltransport\s*24|moebeltransport24|\bmt24\b/i;
const SUBJECT_ID_RE = /angebotsanfrage\s*[:#]?\s*(\d{4,})/i;
const BODY_ID_RE = /(?:angebotsanfrage|anfrage)(?:\s*[- ]?(?:nr|nummer)\.?)?\s*[:#]?\s*(\d{4,})/i;

const LABEL_ALIASES: Array<{ re: RegExp; key: FieldKey }> = [
  { re: /^(?:kundenname|ansprechpartner|kunde|name)$/i, key: "name" },
  { re: /^(?:telefon|tel|mobil|handy|phone)$/i, key: "phone" },
  { re: /^(?:e-?mail|mail|email)$/i, key: "email" },
  { re: /^(?:umzug von|abholadresse|auszug|von-adresse|startadresse|von)$/i, key: "from" },
  { re: /^(?:umzug nach|zieladresse|einzug|nach-adresse|lieferadresse|nach)$/i, key: "to" },
  { re: /^(?:umzugsdatum|umzugstermin|wunschtermin|termin|datum)$/i, key: "date" },
  { re: /^(?:details|nachricht|anmerkungen|anmerkung|bemerkung|beschreibung|zusatzinfo|kommentar)$/i, key: "details" },
];

type FieldKey = "name" | "phone" | "email" | "from" | "to" | "date" | "details";

export interface AddressParts {
  line1: string;
  postcode: string;
  city: string;
  text: string;
}

export interface MoebeltransportLead {
  inquiryId: string;
  customer: {
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  fromAddress: string | null;
  toAddress: string | null;
  fromLocation: AddressParts | null;
  toLocation: AddressParts | null;
  moveDate: string | null;
  details: string | null;
}

export function isMoebeltransportSender(from: string | null | undefined): boolean {
  return BRAND_RE.test(from ?? "");
}

/** Portal mail, as opposed to a newsletter from the same domain. */
export function isMoebeltransportLeadEmail(
  from: string | null | undefined,
  subject: string | null | undefined,
  body?: string | null
): boolean {
  const head = `${subject ?? ""}\n${(body ?? "").slice(0, 800)}`;
  const branded = isMoebeltransportSender(from) || BRAND_RE.test(head);
  return branded && (SUBJECT_ID_RE.test(subject ?? "") || BODY_ID_RE.test(head));
}

export function parseMoebeltransportLeadEmail(
  subject: string | null | undefined,
  body: string | null | undefined,
  from?: string | null
): MoebeltransportLead | null {
  const text = (body ?? "").replace(/\r\n/g, "\n");
  const branded = isMoebeltransportSender(from) || BRAND_RE.test(`${subject ?? ""}\n${text.slice(0, 1500)}`);
  const subjectId = (subject ?? "").match(SUBJECT_ID_RE)?.[1] ?? null;
  const bodyId = text.match(BODY_ID_RE)?.[1] ?? null;
  const inquiryId = subjectId ?? bodyId;
  if (!inquiryId) return null;

  const fields = parseFields(text);
  const fullName = clean(fields.name);
  const email = emailFrom(fields.email);
  const phone = phoneFrom(fields.phone);
  const fromText = clean(fields.from);
  const toText = clean(fields.to);
  const details = clean(fields.details);
  const moveDate = deDateToYmd(fields.date);

  const structured = !!(fullName || email) && !!(fromText || toText || phone || email || details);
  if (!branded && !structured) return null;
  if (!branded && !(fullName || email) ) return null;
  if (!(fullName || email)) return null;
  if (!branded && !subjectId) return null;

  return {
    inquiryId,
    customer: { fullName, email, phone },
    fromAddress: fromText || null,
    toAddress: toText || null,
    fromLocation: fromText ? splitAddress(fromText) : null,
    toLocation: toText ? splitAddress(toText) : null,
    moveDate,
    details,
  };
}

export function moebeltransportContactEmail(lead: MoebeltransportLead): string {
  return lead.customer.email ?? `mt24-${lead.inquiryId}@moebeltransport24.lead`;
}

function parseFields(text: string): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  let current: FieldKey | null = null;
  let blanks = 0;
  const chunks: Partial<Record<FieldKey, string[]>> = {};

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blanks += 1;
      if (blanks >= 2) current = null;
      continue;
    }
    blanks = 0;
    let pending: string | null = line;
    let matched = false;
    while (pending) {
      const hit = matchLabel(pending);
      if (!hit) break;
      matched = true;
      current = hit.key;
      const peeled = splitTrailingLabel(hit.rest);
      chunks[current] = chunks[current] ?? [];
      if (peeled.value) chunks[current]!.push(peeled.value);
      pending = peeled.trailing;
    }
    if (!matched && current && pending) {
      chunks[current] = chunks[current] ?? [];
      chunks[current]!.push(pending);
    }
  }

  for (const key of Object.keys(chunks) as FieldKey[]) {
    const joined = (chunks[key] ?? []).join(key === "from" || key === "to" || key === "details" ? "\n" : " ").trim();
    if (joined && !out[key]) out[key] = joined;
  }
  return out;
}

function matchLabel(line: string): { key: FieldKey; rest: string } | null {
  const idx = line.search(/[:：]/);
  const head = (idx > 0 ? line.slice(0, idx) : line).trim().replace(/[.\s]+$/g, "");
  const rest = idx > 0 ? line.slice(idx + 1).trim() : "";
  if (!head || head.length > 40) return null;
  for (const alias of LABEL_ALIASES) {
    if (alias.re.test(head)) return { key: alias.key, rest };
  }
  return null;
}

/** "Max Mustermann Tel.: 0151…" keeps the name and hands the next label back. */
function splitTrailingLabel(rest: string): { value: string; trailing: string | null } {
  const marker =
    /\s+(?=(?:kundenname|ansprechpartner|kunde|name|telefon|tel\.?|mobil|handy|phone|e-?mail|mail|email|umzug von|abholadresse|auszug|von-adresse|startadresse|von|umzug nach|zieladresse|einzug|nach-adresse|lieferadresse|nach|umzugsdatum|umzugstermin|wunschtermin|termin|datum|details|nachricht|anmerkungen|anmerkung|bemerkung|beschreibung|zusatzinfo|kommentar)\s*[:：])/i;
  const idx = rest.search(marker);
  if (idx <= 0) return { value: rest, trailing: null };
  return { value: rest.slice(0, idx).trim(), trailing: rest.slice(idx).trim() };
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function emailFrom(value: string | undefined): string | null {
  const match = (value ?? "").match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  if (!match) return null;
  const email = match[0].toLowerCase();
  if (/moebeltransport24|formspree\.io|kleinanzeigen\.de|immobilienscout24\.de/.test(email)) return null;
  return email;
}

function phoneFrom(value: string | undefined): string | null {
  const match = (value ?? "").match(/(\+?\d[\d\s()/.+\-]{6,}\d)/);
  if (!match) return null;
  const compact = match[1].replace(/[^\d+]/g, "");
  if (compact.replace(/\D/g, "").length < 7) return null;
  return match[1].replace(/\s+/g, " ").trim();
}

export function deDateToYmd(value: string | undefined): string | null {
  const text = value ?? "";
  const de = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (de) return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function splitAddress(value: string): AddressParts {
  const text = value.replace(/\s*\n\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
  const match = text.match(/(\d{5})\s+([^,]+)$/);
  if (!match) return { line1: text, postcode: "", city: "", text };
  const city = match[2].trim();
  const before = text.slice(0, match.index).replace(/,\s*$/, "").trim();
  return { line1: before, postcode: match[1], city, text };
}
