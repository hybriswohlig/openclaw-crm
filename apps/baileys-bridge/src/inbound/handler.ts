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
 *                              dedupes by (channel account, externalMessageId).
 *
 * Own sends from `POST /accounts/:id/send` are NOT recorded here. Baileys
 * emits those as `messages.upsert` type `append` on `nextTick` (see
 * messages-send.js, `emitOwnEvents`). Live ingest only handles `notify`, so
 * the echo is not stored as a phone-typed message. The HTTP send handler
 * posts the row itself (`origin: "bridge-send"`) after `sendMessage` returns.
 * A history catch-up may also see `append`, but it skips ids this process
 * just sent and does not post unless the CRM opted in (`postToCrm`).
 *
 * Idempotency on both sides is enforced server-side by the unique constraint
 * on (conversation_id, external_message_id) plus an account-scoped lookup, so
 * retries / echo are safe.
 */
import { appendFile } from "node:fs/promises";
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
import { shouldKeepHistoryMessage } from "./history.js";

export interface InboundHandlerArgs {
  accountId: string;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
  /**
   * Set for a fresh pair, and for any socket once the CRM can store a
   * catch-up safely. `postToCrm` is false until that confirmation: the
   * rows are spooled on disk instead of being sent through the live
   * ingest path, which would arm the sales agent.
   */
  history: { cutoffMs: number; postToCrm: boolean } | null;
  /**
   * Ids this process just sent via `POST /accounts/:id/send`. Their append
   * echo must not be stored again as catch-up.
   */
  isBridgeSend?: (externalMessageId: string) => boolean;
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

const HISTORY_SPOOL = "/tmp/baileys-history-catchup.jsonl";

export function attachInboundHandler(args: InboundHandlerArgs): void {
  const { accountId, sock, crm, log, history, isBridgeSend } = args;

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // 'notify' = real-time delivery (inbound, and fromMe typed on the phone).
    // 'append' is offline catch-up AND the local echo of sock.sendMessage
    // (Baileys emitOwnEvents, scheduled on nextTick). Without an armed
    // catch-up, append stays dropped so a history sync cannot recreate old
    // leads and a bridge send is recorded only by the HTTP handler.
    if (type === "notify") {
      void ingestBatch({
        accountId,
        messages,
        sock,
        crm,
        log,
        historySync: false,
        postToCrm: true,
      });
      return;
    }
    if (type === "append" && history) {
      const batch = messages.slice();
      // The echo is queued on nextTick inside sendMessage, which runs before
      // sendText/sendMedia can remember the id. Wait until that continuation
      // has marked the id, then drop it from the catch-up.
      setImmediate(() => {
        void ingestHistory({
          accountId,
          messages: batch,
          sock,
          crm,
          log,
          cutoffMs: history.cutoffMs,
          postToCrm: history.postToCrm,
          source: "append",
          isBridgeSend,
        });
      });
    }
  });

  if (!history) return;

  sock.ev.on("messaging-history.set", ({ messages, progress, isLatest }) => {
    log.info(
      {
        accountId,
        count: messages?.length ?? 0,
        progress: progress ?? null,
        isLatest: isLatest ?? null,
      },
      "[history] chunk",
    );
    void ingestHistory({
      accountId,
      messages: messages ?? [],
      sock,
      crm,
      log,
      cutoffMs: history.cutoffMs,
      postToCrm: history.postToCrm,
      source: "messaging-history.set",
      isBridgeSend,
    });
  });
}

function messageSentAtMs(msg: WAMessage): number {
  const raw = msg.messageTimestamp;
  const seconds = typeof raw === "number" ? raw : Number(raw ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000;
}

async function ingestBatch(args: {
  accountId: string;
  messages: WAMessage[];
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
  historySync: boolean;
  /** History rows default to spool-only. Live notify passes true. */
  postToCrm?: boolean;
}): Promise<void> {
  const {
    accountId,
    messages,
    sock,
    crm,
    log,
    historySync,
    postToCrm = false,
  } = args;
  for (const msg of messages) {
    try {
      if (msg?.key?.fromMe) {
        await ingestOutboundOne({
          accountId,
          msg,
          sock,
          crm,
          log,
          historySync,
          postToCrm,
        });
      } else {
        await ingestOne({
          accountId,
          msg,
          sock,
          crm,
          log,
          historySync,
          postToCrm,
        });
      }
    } catch (err) {
      log.error(
        { err, accountId, msgId: msg?.key?.id, fromMe: !!msg?.key?.fromMe },
        "[inbound] ingest failed",
      );
    }
  }
}

async function ingestHistory(args: {
  accountId: string;
  messages: WAMessage[];
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
  cutoffMs: number;
  postToCrm: boolean;
  source: string;
  isBridgeSend?: (externalMessageId: string) => boolean;
}): Promise<void> {
  const {
    accountId,
    messages,
    sock,
    crm,
    log,
    cutoffMs,
    postToCrm,
    source,
    isBridgeSend,
  } = args;
  const inWindow = messages
    .filter((msg) =>
      shouldKeepHistoryMessage(
        messageSentAtMs(msg),
        cutoffMs,
        msg.key?.id,
        isBridgeSend,
      ),
    )
    .sort((a, b) => messageSentAtMs(a) - messageSentAtMs(b));
  if (inWindow.length === 0) {
    log.info(
      { accountId, source, received: messages.length, cutoffMs },
      "[history] nothing inside the catch-up window",
    );
    return;
  }
  log.info(
    { accountId, source, received: messages.length, ingesting: inWindow.length },
    "[history] ingesting catch-up",
  );
  await ingestBatch({
    accountId,
    messages: inWindow,
    sock,
    crm,
    log,
    historySync: true,
    postToCrm,
  });
}

async function spoolHistory(
  kind: "in" | "out",
  payload: InboundPayload | OutboundPayload,
): Promise<void> {
  await appendFile(HISTORY_SPOOL, JSON.stringify({ kind, payload }) + "\n");
}

async function ingestOne(args: {
  accountId: string;
  msg: WAMessage;
  sock: WASocket;
  crm: CrmClient;
  log: Logger;
  historySync?: boolean;
  /** Default false so a catch-up cannot post unless the caller opts in. */
  postToCrm?: boolean;
}): Promise<void> {
  const {
    accountId,
    msg,
    sock,
    crm,
    log,
    historySync = false,
    postToCrm = false,
  } = args;
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
  // Protocol, reaction, and other non-content history rows would mint empty
  // threads. Live notify keeps its previous behaviour.
  if (historySync && !body.trim() && !kind) return;

  const attachments: InboundAttachment[] = [];
  // Catch-up can be hundreds of media messages. Downloading every byte has
  // OOM'd this process before. Store the preview; the file stays on the phone.
  if (kind && !historySync) {
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
    historySync: historySync || undefined,
    rawHeaders: {
      provider: "baileys-inhouse",
      messageType: kind ?? "text",
      participant: key.participant ?? null,
      ...(historySync ? { source: "history-sync" } : {}),
      ...(peerLid ? { lid: peerLid, lidPnSource } : {}),
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  if (historySync && !postToCrm) await spoolHistory("in", payload);
  else await crm.postInbound(payload);
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
  historySync?: boolean;
  /** Default false so a catch-up cannot post unless the caller opts in. */
  postToCrm?: boolean;
}): Promise<void> {
  const {
    accountId,
    msg,
    sock,
    crm,
    log,
    historySync = false,
    postToCrm = false,
  } = args;
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
  if (historySync && !body.trim() && !kind) return;

  const attachments: InboundAttachment[] = [];
  if (kind && !historySync) {
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
    historySync: historySync || undefined,
    rawHeaders: {
      provider: "baileys-inhouse",
      source: historySync ? "history-sync" : "phone-direct",
      messageType: kind ?? "text",
      ...(peerLid ? { lid: peerLid, lidPnSource } : {}),
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  if (historySync && !postToCrm) await spoolHistory("out", payload);
  else await crm.postOutbound(payload);
}
