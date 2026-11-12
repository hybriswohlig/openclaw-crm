/**
 * WhatsApp history recovered from a Baileys fresh link
 * (`messaging-history.set` / offline `append`).
 *
 * Stored on the inbox timeline only. Nothing in this module sends WhatsApp
 * or email. The two Ceylan channel accounts are refused before any database
 * read so a history import cannot touch their rows or sessions.
 */

export const HISTORY_SYNC_EXCLUDED_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "595a5e23-69c6-4f28-9254-307521ad1e74",
  "61cd807b-72c6-4fb7-af83-ef7145e93386",
]);

export const DEFAULT_HISTORY_WINDOW_DAYS = 7;
export const MIN_HISTORY_WINDOW_DAYS = 1;
export const MAX_HISTORY_WINDOW_DAYS = 30;
/**
 * The bridge subtracts this from `historySince` so a message that landed
 * just inside the window is not dropped. The CRM accepts the same slack.
 */
export const HISTORY_OVERLAP_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const HISTORY_SYNC_SKIP_REASON = "history-sync";

/**
 * What a history row is allowed to do. Approval commands are not executed:
 * `verarbeiteInterneNachricht` sends WhatsApp. Internal numbers are still
 * not stored.
 */
export interface HistoryIngestEffects {
  storeOnTimeline: true;
  armAgent: false;
  staffPush: false;
  scanReviews: false;
  emitActivity: false;
  executeApprovalCommands: false;
  storeInternalNumbers: false;
  takeHumanOwnership: false;
  sendsWhatsApp: false;
  sendsEmail: false;
  aiSkipReason: typeof HISTORY_SYNC_SKIP_REASON;
}

export function historyIngestEffects(): HistoryIngestEffects {
  return {
    storeOnTimeline: true,
    armAgent: false,
    staffPush: false,
    scanReviews: false,
    emitActivity: false,
    executeApprovalCommands: false,
    storeInternalNumbers: false,
    takeHumanOwnership: false,
    sendsWhatsApp: false,
    sendsEmail: false,
    aiSkipReason: HISTORY_SYNC_SKIP_REASON,
  };
}

export function isHistorySyncExcludedAccount(accountId: string | null | undefined): boolean {
  return typeof accountId === "string" && HISTORY_SYNC_EXCLUDED_ACCOUNT_IDS.has(accountId);
}

export function historyWindowDays(
  raw: string | undefined = process.env.BAILEYS_HISTORY_SYNC_DAYS,
): number {
  if (raw == null || raw.trim() === "") return DEFAULT_HISTORY_WINDOW_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_HISTORY_WINDOW_DAYS || n > MAX_HISTORY_WINDOW_DAYS) {
    return DEFAULT_HISTORY_WINDOW_DAYS;
  }
  return n;
}

/** Oldest `sentAt` this CRM will keep for a history row. */
export function historyWindowStartMs(nowMs = Date.now(), days = historyWindowDays()): number {
  return nowMs - days * DAY_MS - HISTORY_OVERLAP_MS;
}

/**
 * `historySince` for the bridge cursor. The bridge treats this as the
 * cutoff and then subtracts {@link HISTORY_OVERLAP_MS}, so the value here
 * is the window start plus that overlap. The messages that get posted
 * then match {@link historyWindowStartMs}.
 */
export function historySinceForBridge(now = new Date(), days = historyWindowDays()): string {
  return new Date(historyWindowStartMs(now.getTime(), days) + HISTORY_OVERLAP_MS).toISOString();
}

export function isHistorySyncMarker(raw: unknown): boolean {
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.source === "history-sync" || record.historySync === true;
}

/** Groups, newsletters, and status broadcasts are not 1:1 inbox threads. */
export function isSkippedWhatsAppThread(
  peerJid: string | null | undefined,
  peerWaId?: string | null,
): boolean {
  const jid = (peerJid ?? peerWaId ?? "").replace(/\s+/g, "");
  if (!jid) return false;
  if (jid === "status@broadcast") return true;
  return /@(?:g\.us|newsletter|broadcast)$/.test(jid);
}

export interface FollowupSpeakerMessage {
  direction: string;
  historySync: boolean;
}

/**
 * Outbound rows that were imported from history must not count as
 * "we spoke last". Otherwise a backfill can make the follow-up engine send.
 * Inbound history still counts, so a customer who wrote during the gap
 * blocks a nudge.
 */
export function messagesForFollowupSpeaker<T extends FollowupSpeakerMessage>(rows: T[]): T[] {
  return rows.filter((row) => !(row.direction === "outbound" && row.historySync));
}

export function followupTrailingOutbound(rows: FollowupSpeakerMessage[]): {
  trailing: number;
  lastIsOutbound: boolean;
} {
  const visible = messagesForFollowupSpeaker(rows);
  let trailing = 0;
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].direction === "outbound") trailing += 1;
    else break;
  }
  return {
    trailing,
    lastIsOutbound: visible.length > 0 && visible[visible.length - 1].direction === "outbound",
  };
}

export interface HistorySpoolPayload {
  accountId?: unknown;
  peerWaId?: unknown;
  peerJid?: unknown;
  peerLid?: unknown;
  body?: unknown;
  text?: unknown;
  previewLabel?: unknown;
  externalMessageId?: unknown;
  sentAt?: unknown;
}

export interface PlannedHistoryRow {
  kind: "in" | "out";
  accountId: string;
  peerWaId: string;
  peerJid: string | null;
  peerLid: string | null;
  body: string;
  previewLabel: string | null;
  externalMessageId: string;
  sentAt: string;
}

export type HistorySkipReason =
  | "excluded_account"
  | "other_account"
  | "outside_window"
  | "group_or_status"
  | "missing_id"
  | "invalid"
  | "duplicate_in_file";

export interface HistoryImportPlan {
  importRows: PlannedHistoryRow[];
  skipped: Record<HistorySkipReason, number>;
}

function emptySkips(): Record<HistorySkipReason, number> {
  return {
    excluded_account: 0,
    other_account: 0,
    outside_window: 0,
    group_or_status: 0,
    missing_id: 0,
    invalid: 0,
    duplicate_in_file: 0,
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalisePeer(payload: HistorySpoolPayload): {
  peerWaId: string | null;
  peerJid: string | null;
  peerLid: string | null;
} {
  let peerJid: string | null = null;
  const rawJid = asString(payload.peerJid);
  if (rawJid && /^\+?\d{6,20}(?::\d+)?@(?:lid|hosted\.lid|hosted|s\.whatsapp\.net|c\.us)$/.test(rawJid.replace(/\s+/g, ""))) {
    const compact = rawJid.replace(/\s+/g, "");
    const at = compact.indexOf("@");
    const local = compact.slice(0, at).replace(/^\+/, "").replace(/:.*$/, "");
    peerJid = `${local}${compact.slice(at)}`;
  }
  const source = asString(payload.peerWaId) ?? peerJid ?? "";
  const peerWaId = source.replace(/@.*$/, "").replace(/^\+/, "").replace(/:.*$/, "").replace(/\s+/g, "");
  let peerLid: string | null = null;
  const rawLid = asString(payload.peerLid);
  if (rawLid) {
    const match = rawLid.replace(/\s+/g, "").match(/^(\d{6,20})(?::\d+)?@((?:hosted\.)?lid)$/);
    if (match) peerLid = `${match[1]}@${match[2]}`;
  }
  return {
    peerWaId: /^\d{6,20}$/.test(peerWaId) ? peerWaId : null,
    peerJid,
    peerLid,
  };
}

/**
 * Decide which spool rows would be stored. Does not read or write the
 * database and does not contact WhatsApp. Internal numbers are not known
 * here; the apply step drops them without running approval commands.
 */
export function planHistoryImport(
  lines: Array<{ kind?: unknown; payload?: HistorySpoolPayload } | HistorySpoolPayload>,
  opts: { accountId: string; sinceMs: number },
): HistoryImportPlan {
  const skipped = emptySkips();
  const importRows: PlannedHistoryRow[] = [];
  const seen = new Set<string>();

  if (isHistorySyncExcludedAccount(opts.accountId)) {
    skipped.excluded_account += lines.length || 1;
    return { importRows, skipped };
  }

  for (const line of lines) {
    const wrapped = line as { kind?: unknown; payload?: HistorySpoolPayload };
    const payload: HistorySpoolPayload =
      wrapped.payload && typeof wrapped.payload === "object" ? wrapped.payload : (line as HistorySpoolPayload);
    const kindRaw = wrapped.payload ? wrapped.kind : "in";
    const kind = kindRaw === "out" ? "out" : kindRaw === "in" ? "in" : null;
    const accountId = asString(payload.accountId);
    const externalMessageId = asString(payload.externalMessageId);
    if (!kind || !accountId) {
      skipped.invalid += 1;
      continue;
    }
    if (isHistorySyncExcludedAccount(accountId)) {
      skipped.excluded_account += 1;
      continue;
    }
    if (accountId !== opts.accountId) {
      skipped.other_account += 1;
      continue;
    }
    if (!externalMessageId) {
      skipped.missing_id += 1;
      continue;
    }
    const sentAtRaw = asString(payload.sentAt);
    const sentAtMs = sentAtRaw ? Date.parse(sentAtRaw) : NaN;
    if (!Number.isFinite(sentAtMs)) {
      skipped.invalid += 1;
      continue;
    }
    if (sentAtMs < opts.sinceMs) {
      skipped.outside_window += 1;
      continue;
    }
    const peer = normalisePeer(payload);
    if (isSkippedWhatsAppThread(asString(payload.peerJid), asString(payload.peerWaId))) {
      skipped.group_or_status += 1;
      continue;
    }
    if (!peer.peerWaId) {
      skipped.invalid += 1;
      continue;
    }
    if (seen.has(externalMessageId)) {
      skipped.duplicate_in_file += 1;
      continue;
    }
    seen.add(externalMessageId);
    const body = typeof payload.body === "string" ? payload.body : typeof payload.text === "string" ? payload.text : "";
    const preview = asString(payload.previewLabel);
    importRows.push({
      kind,
      accountId,
      peerWaId: peer.peerWaId,
      peerJid: peer.peerJid,
      peerLid: peer.peerLid,
      body,
      previewLabel: preview,
      externalMessageId,
      sentAt: new Date(sentAtMs).toISOString(),
    });
  }

  importRows.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  return { importRows, skipped };
}
