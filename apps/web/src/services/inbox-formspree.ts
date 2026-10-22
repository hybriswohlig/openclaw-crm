/**
 * Formspree website-form notifications.
 *
 * The From address is the form service. The person who filled in the form is
 * in the labeled body (or, as a fallback, Reply-To when that is not Formspree).
 * Pure and dependency-free.
 */

import { deDateToYmd, splitAddress, type AddressParts } from "./inbox-moebeltransport";

const FORMSPREE_RE = /formspree\.io/i;

const LABEL_ALIASES: Array<{ re: RegExp; key: FieldKey }> = [
  { re: /^(?:vorname|first\s*name)$/i, key: "firstName" },
  { re: /^(?:nachname|last\s*name)$/i, key: "lastName" },
  { re: /^(?:name|ihr\s*name|full\s*name)$/i, key: "name" },
  { re: /^(?:e-?mail|email|mail)$/i, key: "email" },
  { re: /^(?:telefon|tel|mobil|handy|phone)$/i, key: "phone" },
  { re: /^(?:umzug von|von|from|abholadresse)$/i, key: "from" },
  { re: /^(?:umzug nach|nach|to|zieladresse)$/i, key: "to" },
  { re: /^(?:umzugsdatum|umzugstermin|wunschtermin|termin|datum|move\s*date|date)$/i, key: "date" },
  { re: /^(?:nachricht|message|details|anliegen|kommentar|comment|anmerkung)$/i, key: "message" },
];

type FieldKey =
  | "name"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "from"
  | "to"
  | "date"
  | "message";

export interface FormspreeLead {
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
  message: string | null;
}

export function isFormspreeEmail(input: {
  from?: string | null;
  subject?: string | null;
  body?: string | null;
  headers?: Record<string, unknown> | null;
}): boolean {
  if (FORMSPREE_RE.test(input.from ?? "")) return true;
  if (FORMSPREE_RE.test(input.subject ?? "")) return true;
  if (FORMSPREE_RE.test((input.body ?? "").slice(0, 4000))) return true;
  const headers = input.headers ?? {};
  for (const key of Object.keys(headers)) {
    if (/formspree/i.test(key)) return true;
    const value = headers[key];
    if (typeof value === "string" && FORMSPREE_RE.test(value)) return true;
  }
  return false;
}

export function parseFormspreeEmail(input: {
  from?: string | null;
  subject?: string | null;
  body?: string | null;
  replyTo?: string | null;
  headers?: Record<string, unknown> | null;
}): FormspreeLead | null {
  if (!isFormspreeEmail(input)) return null;
  const text = (input.body ?? "").replace(/\r\n/g, "\n");
  const fields = parseFields(text);
  const email = emailFrom(fields.email) ?? emailFrom(replyToCustomer(input.replyTo));
  const phone = phoneFrom(fields.phone);
  const fullName = joinName(fields);
  const message = clean(fields.message);
  const fromText = clean(fields.from);
  const toText = clean(fields.to);
  if (!email && !fullName) return null;
  if (!message && !fromText && !toText && !phone && !fields.date) {
    // A Formspree envelope with no request content is not a lead.
    if (!email || !fullName) return null;
  }

  return {
    customer: { fullName, email, phone },
    fromAddress: fromText || null,
    toAddress: toText || null,
    fromLocation: fromText ? splitAddress(fromText) : null,
    toLocation: toText ? splitAddress(toText) : null,
    moveDate: deDateToYmd(fields.date),
    message,
  };
}

export function formspreeContactEmail(lead: FormspreeLead, messageId: string): string {
  if (lead.customer.email) return lead.customer.email;
  const slug = messageId.replace(/[^\w.-]+/g, "").slice(0, 40) || "anfrage";
  return `form-${slug}@website.lead`;
}

export function formspreeThreadKey(lead: FormspreeLead, messageId: string): string {
  const who = (lead.customer.email ?? lead.customer.phone ?? "anon").toLowerCase();
  return `form:${who}:${messageId}`;
}

function replyToCustomer(replyTo: string | null | undefined): string {
  const value = (replyTo ?? "").trim();
  if (!value || FORMSPREE_RE.test(value)) return "";
  return value;
}

function joinName(fields: Partial<Record<FieldKey, string>>): string {
  const combined = clean(fields.name);
  if (combined) return combined;
  return [clean(fields.firstName), clean(fields.lastName)].filter(Boolean).join(" ").trim();
}

function parseFields(text: string): Partial<Record<FieldKey, string>> {
  const chunks: Partial<Record<FieldKey, string[]>> = {};
  let current: FieldKey | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^[-_=]{3,}$/.test(line)) {
      current = null;
      continue;
    }
    const hit = matchLabel(line);
    if (hit) {
      current = hit.key;
      chunks[current] = chunks[current] ?? [];
      if (hit.rest) chunks[current]!.push(hit.rest);
      continue;
    }
    if (current && (current === "message" || current === "from" || current === "to")) {
      chunks[current]!.push(line);
    } else {
      current = null;
    }
  }
  const out: Partial<Record<FieldKey, string>> = {};
  for (const key of Object.keys(chunks) as FieldKey[]) {
    const joined = (chunks[key] ?? []).join(key === "message" || key === "from" || key === "to" ? "\n" : " ").trim();
    if (joined) out[key] = joined;
  }
  return out;
}

function matchLabel(line: string): { key: FieldKey; rest: string } | null {
  const idx = line.search(/[:：]/);
  const head = (idx > 0 ? line.slice(0, idx) : line).trim();
  const rest = idx > 0 ? line.slice(idx + 1).trim() : "";
  if (!head || head.length > 40) return null;
  for (const alias of LABEL_ALIASES) {
    if (alias.re.test(head)) return { key: alias.key, rest };
  }
  return null;
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/[ \t]+\n/g, "\n").trim();
}

function emailFrom(value: string | undefined): string | null {
  const match = (value ?? "").match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  if (!match) return null;
  const email = match[0].toLowerCase();
  if (FORMSPREE_RE.test(email)) return null;
  return email;
}

function phoneFrom(value: string | undefined): string | null {
  const match = (value ?? "").match(/(\+?\d[\d\s()/.+\-]{6,}\d)/);
  if (!match) return null;
  if (match[1].replace(/\D/g, "").length < 7) return null;
  return match[1].replace(/\s+/g, " ").trim();
}
