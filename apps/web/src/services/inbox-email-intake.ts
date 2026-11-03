/**
 * Pure helpers for email threading, sent-folder choice, and direct-lead deals.
 * No database. The ingest path and the dry-run backfill both use these so the
 * match rules stay in one place.
 */

export const EMAIL_THREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const SUBJECT_PREFIX =
  /^(?:(?:re|aw|wg|fwd|fw)\s*(?:\[\d+\])?\s*:\s*)+/i;

const MOVE_DATE_LABEL =
  /(?:umzugsdatum|umzugstermin|wunschtermin|geplanter\s+umzug|umzug\s+am)\s*[:\-]?\s*(\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]+\.?\s+\d{4})/i;

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

export interface ThreadMessageRef {
  externalMessageId: string | null;
  conversationId: string;
  channelAccountId: string;
}

export interface ThreadConversationRef {
  id: string;
  channelAccountId: string;
  contactId: string;
  externalThreadId: string | null;
  subject: string | null;
  status: string;
  lastMessageAt: Date | string | null;
  createdAt?: Date | string | null;
}

export type ThreadMatchVia = "in-reply-to" | "references" | "subject";

export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const bare = value.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return bare || null;
}

/** Forms we compare against stored Message-IDs and thread keys (with and without brackets). */
export function messageIdLookupKeys(value: string | null | undefined): string[] {
  const norm = normalizeMessageId(value);
  if (!norm) return [];
  return [norm, `<${norm}>`];
}

export function sameMessageId(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeMessageId(a);
  const right = normalizeMessageId(b);
  return !!left && left === right;
}

/** In-Reply-To or References, split on whitespace, de-duplicated, brackets stripped. */
export function headerIdList(value: unknown): string[] {
  if (value == null || value === false) return [];
  const parts: string[] = [];
  const push = (item: unknown) => {
    if (typeof item !== "string") return;
    for (const bit of item.split(/\s+/)) {
      const trimmed = bit.trim();
      if (trimmed) parts.push(trimmed);
    }
  };
  if (Array.isArray(value)) {
    for (const item of value) push(item);
  } else {
    push(value);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const norm = normalizeMessageId(part);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** Strip repeated Re:/AW:/Fwd:/FW:/WG: and collapse whitespace. */
export function normalizeEmailSubject(subject: string | null | undefined): string {
  return (subject ?? "").replace(SUBJECT_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function idsMatch(stored: string | null | undefined, wanted: Set<string>): boolean {
  const norm = normalizeMessageId(stored);
  return !!norm && wanted.has(norm);
}

/**
 * Match an inbound or outbound mail onto an existing conversation of the same
 * channel. Header ids win over the subject fallback. Subject fallback never
 * crosses contacts, closed threads, or the time window.
 */
export function matchEmailThread(input: {
  channelAccountId: string;
  contactId: string;
  sentAt: Date;
  subject: string | null;
  inReplyTo?: unknown;
  references?: unknown;
  messages: ThreadMessageRef[];
  conversations: ThreadConversationRef[];
  windowMs?: number;
}): { conversationId: string; via: ThreadMatchVia } | null {
  const windowMs = input.windowMs ?? EMAIL_THREAD_WINDOW_MS;
  const inReply = new Set(headerIdList(input.inReplyTo));
  const references = new Set(headerIdList(input.references));
  const onChannel = input.conversations.filter((conv) => conv.channelAccountId === input.channelAccountId);
  const byId = new Map(onChannel.map((conv) => [conv.id, conv]));

  const headerHit = (wanted: Set<string>): string | null => {
    if (wanted.size === 0) return null;
    const hits = new Set<string>();
    for (const message of input.messages) {
      if (message.channelAccountId !== input.channelAccountId) continue;
      if (!byId.has(message.conversationId)) continue;
      if (idsMatch(message.externalMessageId, wanted)) hits.add(message.conversationId);
    }
    for (const conv of onChannel) {
      if (idsMatch(conv.externalThreadId, wanted)) hits.add(conv.id);
    }
    if (hits.size === 0) return null;
    return [...hits].sort((a, b) => {
      const aTime = timeOf(byId.get(a)?.createdAt) ?? timeOf(byId.get(a)?.lastMessageAt) ?? 0;
      const bTime = timeOf(byId.get(b)?.createdAt) ?? timeOf(byId.get(b)?.lastMessageAt) ?? 0;
      return aTime - bTime;
    })[0]!;
  };

  const byReply = headerHit(inReply);
  if (byReply) return { conversationId: byReply, via: "in-reply-to" };
  const byReferences = headerHit(references);
  if (byReferences) return { conversationId: byReferences, via: "references" };

  const normalized = normalizeEmailSubject(input.subject);
  if (!normalized || !input.contactId) return null;
  const sentMs = input.sentAt.getTime();
  const subjectHits = onChannel
    .filter((conv) => conv.contactId === input.contactId)
    .filter((conv) => conv.status === "open")
    .filter((conv) => normalizeEmailSubject(conv.subject) === normalized)
    .filter((conv) => {
      const at = timeOf(conv.lastMessageAt);
      return at != null && Math.abs(sentMs - at) <= windowMs;
    })
    .sort((a, b) => (timeOf(b.lastMessageAt) ?? 0) - (timeOf(a.lastMessageAt) ?? 0));
  const subjectHit = subjectHits[0];
  if (!subjectHit) return null;
  return { conversationId: subjectHit.id, via: "subject" };
}

/**
 * Deal to copy onto a brand-new conversation of a known contact: the deal on
 * that contact's most recently active open conversation. A closed thread does
 * not donate its deal; the lead path can still attach an open CRM deal.
 */
export function pickInheritedDeal(
  rows: { dealRecordId: string | null; status: string; lastMessageAt: Date | string | null }[]
): string | null {
  const open = rows
    .filter((row) => row.status === "open" && row.dealRecordId)
    .sort((a, b) => (timeOf(b.lastMessageAt) ?? 0) - (timeOf(a.lastMessageAt) ?? 0));
  return open[0]?.dealRecordId ?? null;
}

/** IMAP special-use `\Sent`, otherwise a well-known Sent/Gesendet path. */
export function pickSentMailbox(
  boxes: { path: string; specialUse?: string | null }[]
): string | null {
  const flagged = boxes.find((box) => (box.specialUse ?? "").toLowerCase() === "\\sent");
  if (flagged?.path) return flagged.path;
  const named = boxes.find((box) => {
    const path = box.path.toLowerCase();
    return (
      /\[gmail\]\/(sent mail|gesendet|gesendete nachrichten)$/.test(path) ||
      /(^|[\\/])(sent|sent mail|sent items|gesendet|gesendete)([\\/]|$)/.test(path)
    );
  });
  return named?.path ?? null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function toIsoDate(token: string): string | null {
  const trimmed = token.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dotted = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotted) return isoDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
  const named = trimmed.match(/^(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\.?\s+(\d{4})$/);
  if (!named) return null;
  const month = MONTHS[named[2]!.toLowerCase()];
  if (!month) return null;
  return isoDate(Number(named[3]), month, Number(named[1]));
}

/**
 * Move date only when the mail labels it (Umzugsdatum, Wunschtermin, …).
 * A bare date in the signature or the mail header stays empty.
 */
export function parseMovingDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(MOVE_DATE_LABEL);
  if (!match?.[1]) return null;
  return toIsoDate(match[1]);
}
