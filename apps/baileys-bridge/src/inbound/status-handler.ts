/**
 * Delivery / read receipt handler.
 *
 * Subscribes to `messages.update` and forwards status changes for our own
 * outbound messages back to the CRM. Inbound messages don't need this —
 * the CRM stores them as `received` already.
 */
import type { WASocket } from "baileys";
import type { Logger } from "../lib/logger.js";
import type { CrmClient } from "../lib/crm-client.js";

export interface StatusHandlerArgs {
  accountId: string;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
}

// proto.WebMessageInfo.Status enum values used by Baileys' updates:
//   0 ERROR, 1 PENDING, 2 SERVER_ACK (sent), 3 DELIVERY_ACK (delivered),
//   4 READ, 5 PLAYED.
function mapStatus(
  s: number | null | undefined,
): "sent" | "delivered" | "read" | "failed" | null {
  if (s == null) return null;
  if (s === 0) return "failed";
  if (s === 2) return "sent";
  if (s === 3) return "delivered";
  if (s === 4 || s === 5) return "read";
  return null;
}

export function attachStatusHandler(args: StatusHandlerArgs): void {
  const { accountId, sock, crm, log } = args;

  sock.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      try {
        if (!u.key?.id) continue;
        // Only mirror updates for our own outbound messages — receipts for
        // inbound aren't useful on the CRM side.
        if (!u.key.fromMe) continue;
        const next = mapStatus(u.update?.status);
        if (!next) continue;
        await crm.postStatus({
          accountId,
          externalMessageId: u.key.id,
          status: next,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        log.warn(
          { err, accountId, msgId: u?.key?.id },
          "[status] forward failed (non-fatal)",
        );
      }
    }
  });
}
