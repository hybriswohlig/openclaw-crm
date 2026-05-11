/**
 * Connection lifecycle wiring for a single Baileys socket.
 *
 * Responsibilities:
 *   - emit `awaiting_qr` / `connecting` / `connected` / `logged_out`
 *     pairing-update webhooks back to the CRM
 *   - persist the QR string verbatim in the CRM (the integrations UI renders
 *     it as a QR code via the `qrcode` package)
 *   - decide whether to reconnect after a `connection: 'close'`, with
 *     exponential backoff
 *
 * The manager that owns this socket installs the event listeners; we just
 * provide the decision logic + webhook payload shaping.
 */
import { DisconnectReason } from "baileys";
import type { ConnectionState } from "baileys";
import type { Logger } from "../lib/logger.js";
import type { CrmClient } from "../lib/crm-client.js";

export type ConnectionDecision =
  | { action: "reconnect"; delayMs: number }
  | { action: "stop_logged_out"; reason: string }
  | { action: "stop_error"; reason: string };

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

export function nextBackoffMs(retryCount: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retryCount);
  // ±20% jitter so multiple sockets don't reconnect in lockstep.
  const jitter = exp * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

export function classifyDisconnect(
  lastDisconnect: ConnectionState["lastDisconnect"],
  retryCount: number,
): ConnectionDecision {
  // Both Boom errors and plain WhatsApp stream errors expose `output.statusCode`.
  // Duck-type the field so we don't bring @hapi/boom in as a direct dep.
  const err = lastDisconnect?.error as
    | { output?: { statusCode?: number } }
    | undefined;
  const statusCode = err?.output?.statusCode;

  // Unrecoverable — device unlinked from the phone.
  if (statusCode === DisconnectReason.loggedOut) {
    return { action: "stop_logged_out", reason: "loggedOut" };
  }
  // Connection replaced (another device opened with the same auth) — also
  // terminal; the operator will need to re-pair.
  if (statusCode === DisconnectReason.connectionReplaced) {
    return { action: "stop_logged_out", reason: "connectionReplaced" };
  }

  // Everything else is recoverable. Most common: restartRequired (after QR
  // scan), 408 timeout, 500 server, 515 stream-error.
  return { action: "reconnect", delayMs: nextBackoffMs(retryCount) };
}

export interface PairingPushArgs {
  accountId: string;
  crm: CrmClient;
  log: Logger;
}

export async function pushPairingUpdate(
  args: PairingPushArgs,
  update: Partial<{
    status:
      | "idle"
      | "awaiting_qr"
      | "awaiting_code"
      | "connecting"
      | "connected"
      | "logged_out"
      | "error";
    qrPayload: string | null;
    pairingCode: string | null;
    ownJid: string | null;
    disconnectReason: string | null;
  }>,
): Promise<void> {
  if (!update.status) return;
  try {
    await args.crm.postPairing({
      accountId: args.accountId,
      status: update.status,
      qrPayload: update.qrPayload,
      pairingCode: update.pairingCode,
      ownJid: update.ownJid,
      disconnectReason: update.disconnectReason,
    });
  } catch (err) {
    args.log.warn(
      { err, accountId: args.accountId, status: update.status },
      "[lifecycle] pairing webhook failed (non-fatal)",
    );
  }
}
