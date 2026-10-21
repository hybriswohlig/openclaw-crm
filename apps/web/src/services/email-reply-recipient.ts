/**
 * Recipient + threading for an inbox email reply.
 *
 * `inbox_conversations.external_thread_id` is a thread key, not a mailbox.
 * It is a Kleinanzeigen relay address, a Gmail thread id (no "@"), or — for
 * IMAP and for threads started in the CRM — a Message-ID such as
 * `<…@mail.gmail.com>`. Send used to copy any thread key that contains "@"
 * into the To header. Message-IDs belong only in In-Reply-To / References.
 */

const BARE_EMAIL =
  /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

/** Gmail puts Message-IDs on this host. It is not a mailbox. */
const GMAIL_MESSAGE_ID_DOMAIN = "mail.gmail.com";

/** Synthetic contact key written when an IS24 lead has no customer email. */
const SYNTHETIC_CONTACT_DOMAIN = "is24.lead";

const SYNTHETIC_MESSAGE_ID = /^(?:uid-\d+|gmail-[a-z0-9]+)@/i;

const NON_CUSTOMER_LOCAL =
  /^(?:no-?reply|no_reply|donotreply|do-not-reply|mailer-daemon|bounce)(?:\+|$)/i;

export const EMAIL_REPLY_NO_RECIPIENT =
  "Kein gültiger Empfänger. Antworten gehen nur an die Kunden-E-Mail (Reply-To oder From der letzten eingehenden Nachricht), nie an eine Message-ID und nie an die eigene Adresse. Versand abgebrochen.";

export type ReplyRecipientSource =
  | "reply-to"
  | "from"
  | "contact"
  | "last-outbound"
  | "thread-address";

export interface InboundReplySource {
  fromAddress?: string | null;
  /** `inbox_messages.raw_headers`: a JSON string or an already-parsed object. */
  rawHeaders?: unknown;
  externalMessageId?: string | null;
}

export interface ReplyRecipientInput {
  /** Mailbox we are sending from. Never a valid recipient. */
  ownAddress: string;
  contactEmail?: string | null;
  /** Thread key. Used as To only when it is itself a customer mailbox (Kleinanzeigen relay). */
  externalThreadId?: string | null;
  lastInbound?: InboundReplySource | null;
  /** To of the latest outbound, for threads we opened before the customer replied. */
  lastOutboundTo?: string | null;
}

export interface ResolvedReplyRecipient {
  address: string;
  source: ReplyRecipientSource;
}

export interface ReplyThreading {
  inReplyTo?: string;
  references: string[];
}

/** A Message-ID token (`<id@host>`) or one of our synthetic IMAP/Gmail fallbacks. */
export function looksLikeMessageId(value: string): boolean {
  const trimmed = value.trim();
  if (/^<[^<>\s]+@[^<>\s]+>$/.test(trimmed)) return true;
  if (SYNTHETIC_MESSAGE_ID.test(trimmed)) return true;
  return false;
}

/**
 * Pull one bare mailbox out of a header value.
 * `Name <addr>` yields addr. A lone `<id@mail.gmail.com>` yields nothing:
 * that shape is a Message-ID, and the Gmail Message-ID host is not a mailbox.
 * Returns null for lists and for anything that is not a single addr-spec.
 */
export function parseEmailAddress(raw: unknown): string | null {
  if (typeof raw === "string") return parseAddressText(raw);
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return null;
    return parseEmailAddress(raw[0]);
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.value)) {
    if (record.value.length !== 1) return null;
    const first = record.value[0];
    if (first && typeof first === "object") {
      const address = (first as { address?: unknown }).address;
      if (typeof address === "string" && address.trim()) return finalizeAddress(address);
    }
    return null;
  }
  if (typeof record.address === "string") return finalizeAddress(record.address);
  if (typeof record.text === "string") return parseAddressText(record.text);
  return null;
}

export function resolveEmailReplyRecipient(
  input: ReplyRecipientInput
): ResolvedReplyRecipient | null {
  const own = input.ownAddress.trim().toLowerCase();
  const blocked = blockedMessageIds(input);
  const headers = headerRecord(input.lastInbound?.rawHeaders);

  const candidates: Array<[ReplyRecipientSource, unknown]> = [
    ["reply-to", headerValue(headers, "reply-to")],
    ["from", input.lastInbound?.fromAddress],
    ["from", headerValue(headers, "from")],
    ["contact", input.contactEmail],
    ["last-outbound", input.lastOutboundTo],
  ];

  // Kleinanzeigen stores the buyer relay on the thread key. Every other "@"
  // thread key is a Message-ID and must not be tried.
  if (input.externalThreadId && !threadKeyIsMessageId(input.externalThreadId, blocked)) {
    candidates.push(["thread-address", input.externalThreadId]);
  }

  for (const [source, raw] of candidates) {
    const address = parseEmailAddress(raw);
    if (!address) continue;
    if (!isCustomerMailbox(address, own, blocked)) continue;
    return { address, source };
  }
  return null;
}

/** In-Reply-To = the inbound Message-ID. References = its chain plus that id. */
export function resolveReplyThreading(input: {
  externalMessageId?: string | null;
  rawHeaders?: unknown;
}): ReplyThreading {
  const references: string[] = [];
  const seen = new Set<string>();
  const add = (token: string | null | undefined) => {
    const formatted = formatMessageId(token);
    if (!formatted) return;
    const key = normalizeMessageId(formatted);
    if (seen.has(key)) return;
    seen.add(key);
    references.push(formatted);
  };

  for (const token of referenceTokens(input.rawHeaders)) add(token);
  add(input.externalMessageId);
  return { inReplyTo: formatMessageId(input.externalMessageId), references };
}

function parseAddressText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Lone `<id@host>` is a Message-ID (or an addr-spec). The Gmail Message-ID
  // host and synthetic ids are rejected by finalizeAddress; a real mailbox
  // written as `<user@gmail.com>` still parses.
  if (/^<[^<>]+>$/.test(trimmed)) return finalizeAddress(trimmed.slice(1, -1));
  const bracketed = [...trimmed.matchAll(/<([^<>]+)>/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (bracketed.length > 1) return null;
  if (bracketed.length === 1) return finalizeAddress(bracketed[0]);
  if (looksLikeMessageId(trimmed)) return null;
  if (/[,;]/.test(trimmed)) return null;
  return finalizeAddress(trimmed);
}

function finalizeAddress(candidate: string): string | null {
  const address = candidate.trim().toLowerCase();
  if (!BARE_EMAIL.test(address)) return null;
  if (address.split("@")[1] === GMAIL_MESSAGE_ID_DOMAIN) return null;
  if (looksLikeMessageId(address)) return null;
  return address;
}

function isCustomerMailbox(address: string, ownAddress: string, blocked: Set<string>): boolean {
  if (blocked.has(address)) return false;
  if (ownAddress && address === ownAddress) return false;
  const [local, domain] = address.split("@");
  if (!local || !domain) return false;
  if (domain === SYNTHETIC_CONTACT_DOMAIN) return false;
  if (NON_CUSTOMER_LOCAL.test(local)) return false;
  return true;
}

function blockedMessageIds(input: ReplyRecipientInput): Set<string> {
  const blocked = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const normalized = normalizeMessageId(value);
    if (normalized.includes("@")) blocked.add(normalized);
  };

  add(input.lastInbound?.externalMessageId);
  const threading = resolveReplyThreading({
    externalMessageId: input.lastInbound?.externalMessageId,
    rawHeaders: input.lastInbound?.rawHeaders,
  });
  if (threading.inReplyTo) add(threading.inReplyTo);
  for (const reference of threading.references) add(reference);

  const headers = headerRecord(input.lastInbound?.rawHeaders);
  const messageId = headerValue(headers, "message-id");
  if (typeof messageId === "string") add(messageId);

  if (input.externalThreadId && threadKeyIsMessageId(input.externalThreadId, blocked)) {
    add(input.externalThreadId);
  }
  return blocked;
}

function threadKeyIsMessageId(threadKey: string, known: Set<string>): boolean {
  const trimmed = threadKey.trim();
  if (!trimmed) return false;
  if (looksLikeMessageId(trimmed)) return true;
  const normalized = normalizeMessageId(trimmed);
  if (normalized.split("@")[1] === GMAIL_MESSAGE_ID_DOMAIN) return true;
  if (known.has(normalized)) return true;
  return false;
}

function normalizeMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}

function formatMessageId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed.includes("@")) return undefined;
  if (/^<[^<>\s]+@[^<>\s]+>$/.test(trimmed)) return trimmed;
  if (/[<>\s,]/.test(trimmed)) return undefined;
  if (!/^[^@\s]+@[^@\s]+$/.test(trimmed)) return undefined;
  return `<${trimmed}>`;
}

function referenceTokens(rawHeaders: unknown): string[] {
  const value = headerValue(headerRecord(rawHeaders), "references");
  const tokens: string[] = [];
  const push = (text: string) => {
    for (const token of text.split(/\s+/)) {
      if (token) tokens.push(token);
    }
  };
  if (typeof value === "string") push(value);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") push(item);
    }
  }
  return tokens;
}

function headerRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

function headerValue(headers: Record<string, unknown> | null, name: string): unknown {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}
