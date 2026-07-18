/**
 * Inbound message handler for one Baileys socket.
 *
 * Subscribes to `messages.upsert`. Two cases:
 *   - `key.fromMe = false`  → customer message → POST /baileys-inbound
 *   - `key.fromMe = true`   → operator typed on the linked phone (NOT via the
 *                              CRM web app) → POST /baileys-outbound, so the
 *                              CRM timeline stays mirrored with the actual
 *                              phone. Messages that the CRM itself sent come
 *                              back here too as `fromMe`; the CRM endpoint
 *                              dedupes by (conversationId, externalMessageId).
 *
 * Idempotency on both sides is enforced server-side by the unique constraint
 * on (conversation_id, external_message_id) so retries / echo are safe.
 */
import type { WAMessage, WAMessageKey, WASocket } from "baileys";
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser } from "baileys";
import type { Logger } from "../lib/logger.js";
import type {
  CrmClient,
  InboundAttachment,
  InboundPayload,
  OutboundPayload,
} from "../lib/crm-client.js";
import {
  textOf,
  mediaKindOf,
  previewLabelFor,
  jidToWaId,
  jidToPeerJid,
} from "./envelope.js";
import { tryDownloadAttachment } from "./media-downloader.js";

export interface InboundHandlerArgs {
  accountId: string;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
}

/**
 * Derive the CRM addressing fields from a message key.
 *
 * For PN-routed chats (`...@s.whatsapp.net`) this is a plain unwrap. For
 * LID-routed chats (`...@lid`) the LID digits are NOT a phone number, so the
 * real phone is resolved via `key.remoteJidAlt` (set when WhatsApp includes
 * the alt attr on the stanza) or the socket's persisted LID<->PN mapping
 * store. `peerWaId` then carries the real phone while `peerJid` keeps the
 * `@lid` addressing replies must target. Without this resolution the CRM
 * keys a SECOND conversation/contact/deal on the LID digits whenever Meta
 * routes a chat through the LID identity.
 *
 * If neither source knows the phone, `peerWaId` falls back to the LID digits
 * (the CRM detects that case by comparing against `peerJid` and skips
 * phone-identity writes).
 */
async function resolvePeerAddressing(args: {
  key: WAMessageKey;
  sock: WASocket;
  log: Logger;
}): Promise<{
  peerWaId: string;
  peerJid: string;
  peerLid: string | null;
  lidPnSource: "remoteJidAlt" | "lidMapping" | null;
}> {
  const { key, sock, log } = args;
  const remoteJid = key.remoteJid ?? "";
  const peerJid = jidToPeerJid(remoteJid);
  let peerWaId = jidToWaId(remoteJid);
  let peerLid: string | null = null;
  let lidPnSource: "remoteJidAlt" | "lidMapping" | null = null;

  // remoteJidAlt names the PEER's other identity. Defensive guard: on fromMe
  // echoes WhatsApp's sender_pn/sender_lid attrs could carry OUR OWN number
  // or LID instead — accepting that would bind the operator's identity to a
  // customer record. Ignore any alt that matches the account's own ids.
  const ownIds = [
    jidToWaId(sock.user?.id ?? ""),
    jidToWaId(sock.user?.lid ?? ""),
  ].filter(Boolean);
  let alt = key.remoteJidAlt;
  if (alt && ownIds.includes(jidToWaId(alt))) {
    alt = undefined;
  }

  if (isLidUser(remoteJid) || isHostedLidUser(remoteJid)) {
    peerLid = peerJid;
    let pnJid =
      alt && (isPnUser(alt) || isHostedPnUser(alt)) ? alt : null;
    if (pnJid) {
      lidPnSource = "remoteJidAlt";
    } else {
      try {
        // Keystore-only lookup (no network); populated automatically from
        // message envelopes, history sync and USync results on send.
        pnJid = await sock.signalRepository.lidMapping.getPNForLID(remoteJid);
        if (pnJid) lidPnSource = "lidMapping";
      } catch (err) {
        log.warn({ err, remoteJid }, "[peer] LID->PN mapping lookup failed");
      }
    }
    if (pnJid) {
      peerWaId = jidToWaId(pnJid);
    } else {
      log.warn(
        { remoteJid },
        "[peer] no PN known for LID, ingesting under LID digits",
      );
    }
  } else if (alt && (isLidUser(alt) || isHostedLidUser(alt))) {
    // PN-routed stanza that also names the peer's LID. Forward it so the CRM
    // can match LID-keyed threads/identities of the same person — WhatsApp
    // flips addressing modes per message, and without this the PN-routed half
    // of a flip can re-split the lead. Deliberately NO lidMapping.getLIDForPN
    // here: that direction falls back to a USync network query per message.
    peerLid = jidToPeerJid(alt);
  }
  return { peerWaId, peerJid, peerLid, lidPnSource };
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
        if (msg?.key?.fromMe) {
          await ingestOutboundOne({ accountId, msg, sock, crm, log });
        } else {
          await ingestOne({ accountId, msg, sock, crm, log });
        }
      } catch (err) {
        log.error(
          { err, accountId, msgId: msg?.key?.id, fromMe: !!msg?.key?.fromMe },
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

  // Match the JID domain, not just the digits: new-format group ids
  // (120363…@g.us) are pure digits and would pass the numeric guard below,
  // then surface in the CRM as digit-named fake 1:1 chats.
  if (/@(?:g\.us|newsletter|broadcast)$/.test(key.remoteJid)) {
    log.debug(
      { accountId, remoteJid: key.remoteJid },
      "[inbound] skipping group/channel thread",
    );
    return;
  }

  const { peerWaId, peerJid, peerLid, lidPnSource } =
    await resolvePeerAddressing({ key, sock, log });
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
    peerJid,
    peerLid,
    peerName: msg.pushName ?? null,
    body,
    previewLabel,
    externalMessageId: key.id,
    sentAt,
    rawHeaders: {
      provider: "baileys-inhouse",
      messageType: kind ?? "text",
      participant: key.participant ?? null,
      ...(peerLid ? { lid: peerLid, lidPnSource } : {}),
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  await crm.postInbound(payload);
}

/**
 * Mirror of `ingestOne` for `key.fromMe = true` events: messages the operator
 * typed directly on the linked WhatsApp Business smartphone app. Posts to the
 * CRM's `/baileys-outbound` endpoint. Whichever side persists first wins; the
 * other side's insert silently no-ops via the unique-index constraint.
 */
async function ingestOutboundOne(args: {
  accountId: string;
  msg: WAMessage;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
}): Promise<void> {
  const { accountId, msg, sock, crm, log } = args;
  const key = msg.key;
  if (!key?.id || !key?.remoteJid) return;
  if (!key.fromMe) return;
  if (key.remoteJid === "status@broadcast") return;
  if (!msg.message) return;

  // See ingestOne: new-format group ids are pure digits — match the domain.
  if (/@(?:g\.us|newsletter|broadcast)$/.test(key.remoteJid)) {
    log.debug(
      { accountId, remoteJid: key.remoteJid },
      "[outbound] skipping group/channel thread",
    );
    return;
  }

  // remoteJid here is the *recipient* (the customer the operator is texting).
  const { peerWaId, peerJid, peerLid, lidPnSource } =
    await resolvePeerAddressing({ key, sock, log });
  if (!/^\d{6,20}$/.test(peerWaId)) {
    log.debug(
      { accountId, remoteJid: key.remoteJid },
      "[outbound] skipping non-1:1 thread",
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

  const payload: OutboundPayload = {
    accountId,
    peerWaId,
    peerJid,
    peerLid,
    body,
    previewLabel,
    externalMessageId: key.id,
    sentAt,
    rawHeaders: {
      provider: "baileys-inhouse",
      source: "phone-direct",
      messageType: kind ?? "text",
      ...(peerLid ? { lid: peerLid, lidPnSource } : {}),
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  await crm.postOutbound(payload);
}
