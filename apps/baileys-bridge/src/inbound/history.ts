/**
 * Cutoff for a re-pair history catch-up.
 *
 * WhatsApp sends the phone's chat history once, when a linked device is
 * paired. The CRM cursor (`historySince`) is the start of the import
 * window. This module subtracts a short overlap; the CRM dedupes by
 * WhatsApp message id. When the cursor omits `historySince`, fall back to
 * a bounded window so a first pair does not mint leads out of years of
 * old chats. The default is 7 days (`HISTORY_SYNC_WINDOW_DAYS`, clamped
 * to 1..30) and matches the CRM cursor.
 */
export const HISTORY_OVERLAP_MS = 5 * 60 * 1000;
export const DEFAULT_HISTORY_WINDOW_DAYS = 7;
export const HISTORY_FALLBACK_MS = DEFAULT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function historyWindowDays(
  raw: string | undefined = process.env.HISTORY_SYNC_WINDOW_DAYS,
): number {
  if (raw == null || raw.trim() === "") return DEFAULT_HISTORY_WINDOW_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 30) return DEFAULT_HISTORY_WINDOW_DAYS;
  return n;
}

export function historyFallbackMs(raw?: string): number {
  return historyWindowDays(raw) * 24 * 60 * 60 * 1000;
}

export function historyCutoffMs(
  historySinceIso: string | null,
  now = Date.now(),
  fallbackMs = historyFallbackMs(),
): number {
  if (historySinceIso) {
    const since = Date.parse(historySinceIso);
    if (Number.isFinite(since)) return since - HISTORY_OVERLAP_MS;
  }
  return now - fallbackMs;
}

/**
 * Baileys defaults `shouldSyncHistoryMessage` to "everything except FULL".
 * `syncFullHistory: true` asks the phone for those FULL chunks, then the
 * library drops them unless this returns true. A fresh pair accepts FULL;
 * the handler still keeps only the window. A restored session keeps the
 * library default so a reconnect does not decode a full history dump.
 */
export function allowHistorySyncType(args: {
  isFull: boolean;
  requestFullHistory: boolean;
}): boolean {
  if (args.isFull && !args.requestFullHistory) return false;
  return true;
}

export function isWithinHistoryWindow(
  sentAtMs: number,
  cutoffMs: number,
): boolean {
  return Number.isFinite(sentAtMs) && sentAtMs > 0 && sentAtMs >= cutoffMs;
}

export interface HistoryCatchup {
  cutoffMs: number;
  /**
   * False until the CRM confirms it can store the catch-up without arming
   * the sales agent. Callers then spool the rows instead of posting them.
   */
  postToCrm: boolean;
}

/**
 * Whether this socket should collect a catch-up at all.
 *
 * `postToCrm` stays false unless the CRM explicitly opts in. A missing
 * cursor route (404) is not that opt-in: a fresh pair still keeps the
 * window, but the rows are spooled. A restored session does not arm
 * catch-up, so a restart cannot replay old chats through live ingest.
 */
export function historyCatchupConfig(args: {
  freshPair: boolean;
  cursorSupported: boolean;
  historySince: string | null;
  now?: number;
}): HistoryCatchup | null {
  if (!args.freshPair && !args.cursorSupported) return null;
  return {
    cutoffMs: historyCutoffMs(
      args.cursorSupported ? args.historySince : null,
      args.now,
    ),
    postToCrm: args.cursorSupported === true,
  };
}

/**
 * Bridge sends are recorded by the HTTP handler (`origin: "bridge-send"`).
 * Baileys also emits that local echo as `messages.upsert` type `append`,
 * which is the same type offline rows use. Those ids must not be ingested
 * a second time as catch-up.
 */
export function shouldKeepHistoryMessage(
  sentAtMs: number,
  cutoffMs: number,
  messageId: string | null | undefined,
  isBridgeSend?: (id: string) => boolean,
): boolean {
  if (messageId && isBridgeSend?.(messageId)) return false;
  return isWithinHistoryWindow(sentAtMs, cutoffMs);
}
