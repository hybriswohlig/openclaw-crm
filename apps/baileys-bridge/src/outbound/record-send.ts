import type { OutboundPayload } from "../lib/crm-client.js";

/**
 * Post one bridge send to the CRM.
 * `skipped` = not a 1:1 chat (nothing to store).
 * `rejected` = the CRM did not store the row.
 * Does not send a WhatsApp message.
 */
export async function postBridgeSendRecord(
  crm: { postOutbound(payload: OutboundPayload): Promise<boolean> },
  args: BridgeSendRecord,
): Promise<"stored" | "skipped" | "rejected"> {
  const payload = bridgeSendOutboundPayload(args);
  if (!payload) return "skipped";
  return (await crm.postOutbound(payload)) ? "stored" : "rejected";
}

/**
 * CRM record for a message this bridge just sent with `sock.sendMessage`.
 *
 * Baileys 7 emits that local echo as `messages.upsert` type `append`
 * (`upsertMessage(fullMsg, 'append')` on nextTick in messages-send.js, behind
 * `emitOwnEvents`). Live ingest only handles `notify`, so the echo is not
 * stored as a phone-typed message. A history catch-up may also see `append`,
 * but it skips ids this process just sent. Phone-typed messages still arrive
 * as `notify` and are mirrored from there. This payload is the send path's
 * own notice to the CRM.
 *
 * The payload is history only. Nothing in here calls `sendMessage`.
 */

export interface BridgeSendRecord {
  accountId: string;
  /** Digits, or a full JID (`…@lid` / `…@s.whatsapp.net`). */
  peerWaId: string;
  externalMessageId: string;
  kind: "text" | "image" | "video" | "audio" | "document";
  /** Text body, or the media caption (possibly empty). */
  body: string;
  previewLabel?: string | null;
  mimeType?: string;
  fileName?: string;
  mediaBase64?: string;
  sentAt?: string;
}

/** Same addressing rules as the socket send helper. */
export function peerJidFor(peerWaId: string): string {
  if (peerWaId.includes("@")) {
    const at = peerWaId.indexOf("@");
    const local = peerWaId
      .slice(0, at)
      .replace(/^\+/, "")
      .replace(/:.*$/, "")
      .replace(/\s+/g, "");
    return `${local}${peerWaId.slice(at)}`;
  }
  const digits = peerWaId.replace(/\D+/g, "");
  return `${digits}@s.whatsapp.net`;
}

/**
 * Build the CRM outbound body for one bridge send.
 * Returns null for groups, newsletters, and broadcast — those are not CRM threads.
 */
export function bridgeSendOutboundPayload(
  args: BridgeSendRecord,
): OutboundPayload | null {
  const jid = peerJidFor(args.peerWaId);
  if (/@(?:g\.us|newsletter|broadcast)$/.test(jid) || jid === "status@broadcast") {
    return null;
  }
  const at = jid.indexOf("@");
  const peerWaId = jid.slice(0, at).replace(/:.*$/, "");
  if (!/^\d{6,20}$/.test(peerWaId)) return null;

  const payload: OutboundPayload = {
    accountId: args.accountId,
    peerWaId,
    peerJid: jid,
    body: args.body,
    previewLabel: args.previewLabel ?? null,
    externalMessageId: args.externalMessageId,
    sentAt: args.sentAt ?? new Date().toISOString(),
    origin: "bridge-send",
    rawHeaders: {
      provider: "baileys-inhouse",
      source: "bridge-send",
      messageType: args.kind,
    },
  };

  if (args.kind !== "text" && args.mediaBase64) {
    // This body is posted to a Vercel function. Above ~4.5 MB the platform
    // rejects it before the route runs (a ~3 MB file, base64-encoded).
    // recordAfterSend swallows that; the CRM send path stores the attachment.
    const bytes = Buffer.from(args.mediaBase64, "base64");
    payload.attachments = [
      {
        fileName: args.fileName || `${args.kind}.bin`,
        mimeType: args.mimeType || "application/octet-stream",
        fileSize: bytes.length,
        fileContentBase64: args.mediaBase64,
        externalMediaId: args.externalMessageId,
      },
    ];
  }

  return payload;
}
