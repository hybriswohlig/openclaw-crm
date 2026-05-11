/**
 * Inbound message handler for one Baileys socket.
 *
 * Subscribes to `messages.upsert`, filters out fromMe / status broadcasts,
 * unwraps the proto envelope, downloads media if any, and POSTs the
 * normalized payload to the CRM's `/api/v1/inbox/whatsapp/baileys-inbound`
 * endpoint. Idempotency is enforced server-side by the unique constraint
 * on (conversation_id, external_message_id) so retries are safe.
 */
import type { WAMessage, WASocket } from "baileys";
import type { Logger } from "../lib/logger.js";
import type {
  CrmClient,
  InboundAttachment,
  InboundPayload,
} from "../lib/crm-client.js";
import { textOf, mediaKindOf, previewLabelFor, jidToWaId } from "./envelope.js";
import { tryDownloadAttachment } from "./media-downloader.js";

export interface InboundHandlerArgs {
  accountId: string;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
}

export function attachInboundHandler(args: InboundHandlerArgs): void {
  const { accountId, sock, crm, log } = args;

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // 'notify' = real-time delivery; 'append' = history sync (older). We
    // only ingest 'notify' here — history sync would re-create old leads
    // every time the device re-pairs.
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await ingestOne({ accountId, msg, sock, crm, log });
      } catch (err) {
        log.error(
          { err, accountId, msgId: msg?.key?.id },
          "[inbound] ingest failed",
        );
      }
    }
  });
}

async function ingestOne(args: {
  accountId: string;
  msg: WAMessage;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
}): Promise<void> {
  const { accountId, msg, sock, crm, log } = args;
  const key = msg.key;
  if (!key?.id || !key?.remoteJid) return;
  if (key.fromMe) return;
  if (key.remoteJid === "status@broadcast") return;
  if (!msg.message) return;

  const peerWaId = jidToWaId(key.remoteJid);
  if (!/^\d{6,20}$/.test(peerWaId)) {
    // Group / channel / newsletter — skip for now; CRM only ingests 1:1.
    log.debug(
      { accountId, remoteJid: key.remoteJid },
      "[inbound] skipping non-1:1 thread",
    );
    return;
  }

  const body = textOf(msg.message);
  const kind = mediaKindOf(msg.message);
  const previewLabel = previewLabelFor(kind);

  const attachments: InboundAttachment[] = [];
  if (kind) {
    const att = await tryDownloadAttachment({ msg, sock, log });
    if (att) attachments.push(att);
  }

  const sentAtSeconds =
    typeof msg.messageTimestamp === "number"
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp ?? 0);
  const sentAt = sentAtSeconds
    ? new Date(sentAtSeconds * 1000).toISOString()
    : new Date().toISOString();

  const payload: InboundPayload = {
    accountId,
    peerWaId,
    peerName: msg.pushName ?? null,
    body,
    previewLabel,
    externalMessageId: key.id,
    sentAt,
    rawHeaders: {
      provider: "baileys-inhouse",
      messageType: kind ?? "text",
      participant: key.participant ?? null,
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  await crm.postInbound(payload);
}
