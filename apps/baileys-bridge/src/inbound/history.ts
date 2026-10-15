/**
 * Cutoff for a re-pair history catch-up.
 *
 * WhatsApp sends the phone's chat history once, when a linked device is
 * paired. The CRM already has everything it received live before the
 * outage, so the cutoff is the newest stored message (minus a short
 * overlap). The unique index drops true duplicates. When the account has
 * no stored messages, fall back to a bounded window so a first pair does
 * not mint leads out of years of old chats.
 */
export const HISTORY_OVERLAP_MS = 5 * 60 * 1000;
export const HISTORY_FALLBACK_MS = 21 * 24 * 60 * 60 * 1000;

export function historyCutoffMs(
  historySinceIso: string | null,
  now = Date.now(),
): number {
  if (historySinceIso) {
    const since = Date.parse(historySinceIso);
    if (Number.isFinite(since)) return since - HISTORY_OVERLAP_MS;
  }
  return now - HISTORY_FALLBACK_MS;
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
