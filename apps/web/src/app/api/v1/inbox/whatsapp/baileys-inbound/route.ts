/**
 * Baileys WhatsApp inbound ingestion endpoint.
 *
 * Bridge for personal-WhatsApp accounts (linked-device via Baileys) where the
 * actual WhatsApp connection is owned by OpenClaw, not by the CRM. OpenClaw
 * receives the raw message, normalizes it, and POSTs the payload here. The
 * CRM then writes it into `inbox_messages` / `inbox_conversations` using the
 * same logic as the WABA Cloud API webhook (see `inbox-whatsapp.ts`).
 *
 * Auth: Bearer token (api_keys table). The middleware lets `/api/*` requests
 * with a Bearer header through; we re-check on this route via getAuthContext
 * so an attacker cannot blindly inject leads.
 *
 * The endpoint is idempotent on `(channelAccountId, externalMessageId)` so
 * OpenClaw can safely retry on transient failures.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts, inboxMessageAttachments } from "@/db/schema/inbox";
import { eq, and, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { ingestInboundWhatsAppMessage } from "@/services/inbox-whatsapp";

export const dynamic = "force-dynamic";

interface BaileysInboundAttachment {
  /** Display name (e.g. "image.jpeg", "document.pdf"). */
  fileName: string;
  /** MIME type as reported by Baileys / WhatsApp. */
  mimeType: string;
  /** Size in bytes after base64 decode. */
  fileSize: number;
  /** The bytes, base64-encoded. Stored verbatim in inbox_message_attachments.file_content. */
  fileContentBase64: string;
  /** Provider-side media id (Baileys directPath / mediaKey hash) for dedup. */
  externalMediaId?: string | null;
}

interface BaileysInboundPayload {
  /** UUID of the channel_accounts row (channel_type='whatsapp', wa_phone_number_id IS NULL). */
  accountId: string;
  /**
   * Sender's WhatsApp ID (E.164 with or without leading +). For LID-routed
   * chats the bridge resolves this to the REAL phone via remoteJidAlt / the
   * LID mapping store; only when no mapping exists does it carry the LID
   * digits (detected downstream by comparing with peerJid, never treated as
   * a phone identity then).
   */
  peerWaId: string;
  /**
   * Full peer JID with domain preserved (`123@lid` or `123@s.whatsapp.net`).
   * Stored as `external_thread_id` so outbound replies hit the same
   * addressing mode the contact answered from. Required for contacts whose
   * Meta identity has migrated to LID-routing — without it, replies are
   * silently undeliverable. Optional for back-compat with older bridge
   * builds that don't send the field yet.
   */
  peerJid?: string;
  /**
   * The sender's LID JID whenever known, INDEPENDENT of this message's
   * addressing mode: equals peerJid for LID-routed stanzas, and carries the
   * stanza's PN-side alt for PN-routed messages of a LID-capable peer. Used
   * to match LID-keyed threads and to record the wa_lid identity key.
   */
  peerLid?: string | null;
  /** Sender's profile/push name, if known. */
  peerName?: string | null;
  /** Plain-text body. For media-only messages, may be empty (use previewLabel). */
  body: string;
  /** Optional preview label override for media-only messages ("📷 Bild" etc.). */
  previewLabel?: string | null;
  /** Provider-side message ID — used as dedup key. */
  externalMessageId: string;
  /** ISO timestamp of when the message was sent. Defaults to now. */
  sentAt?: string;
  /** Optional metadata blob preserved in raw_headers for debugging. */
  rawHeaders?: Record<string, unknown> | null;
  /**
   * Inline attachment payloads. The bridge has already downloaded the bytes
   * from WhatsApp and base64-encoded them; we just persist. Failures here
   * never block ingest (matches the WABA media path in inbox-whatsapp.ts).
   */
  attachments?: BaileysInboundAttachment[];
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let payload: BaileysInboundPayload;
  try {
    payload = (await req.json()) as BaileysInboundPayload;
  } catch {
    return badRequest("invalid_json");
  }

  // Schema check
  if (!payload.accountId || typeof payload.accountId !== "string") {
    return badRequest("accountId required");
  }
  if (!payload.peerWaId || typeof payload.peerWaId !== "string") {
    return badRequest("peerWaId required");
  }
  if (typeof payload.body !== "string") {
    return badRequest("body must be a string");
  }
  if (!payload.externalMessageId || typeof payload.externalMessageId !== "string") {
    return badRequest("externalMessageId required");
  }

  // Resolve channel account, scoped to this workspace + Baileys-only.
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, payload.accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
        // Baileys-only: WABA accounts are routed via the Meta webhook, not
        // this endpoint. Block accidental cross-routing.
        isNull(channelAccounts.waPhoneNumberId)
      )
    )
    .limit(1);

  if (!account) {
    return NextResponse.json(
      {
        error: "channel_account_not_baileys_or_not_found",
        hint: "Account must be channel_type='whatsapp' with wa_phone_number_id IS NULL",
      },
      { status: 404 }
    );
  }

  // Normalize peer wa-id: strip leading +/whitespace, keep digits.
  // (Baileys typically returns "4915159058963@s.whatsapp.net" — caller
  //  should pre-normalize, but we forgive a bit.)
  const peerWaId = payload.peerWaId
    .replace(/@.*$/, "")
    .replace(/^\+/, "")
    .replace(/\s+/g, "");

  if (!/^\d{6,20}$/.test(peerWaId)) {
    return badRequest("peerWaId must be a digit-only E.164-like phone", { received: payload.peerWaId });
  }

  // peerJid is the full address (`digits@lid` or `digits@s.whatsapp.net`)
  // with device suffix stripped. We persist it so reply sends can target
  // the correct addressing mode.
  let peerJid: string | null = null;
  if (typeof payload.peerJid === "string" && payload.peerJid) {
    const raw = payload.peerJid.replace(/\s+/g, "");
    if (!/^\+?\d{6,20}(?::\d+)?@(?:lid|hosted\.lid|hosted|s\.whatsapp\.net|c\.us|g\.us)$/.test(raw)) {
      return badRequest("peerJid must be a digits@domain JID", { received: payload.peerJid });
    }
    const at = raw.indexOf("@");
    const local = raw.slice(0, at).replace(/^\+/, "").replace(/:.*$/, "");
    peerJid = `${local}${raw.slice(at)}`;
  }

  // peerLid carries the peer's LID identity regardless of this message's
  // addressing mode. Malformed values are dropped, not rejected: the field is
  // advisory and must never block ingest.
  let peerLid: string | null = null;
  if (typeof payload.peerLid === "string" && payload.peerLid) {
    const raw = payload.peerLid.replace(/\s+/g, "");
    const m = raw.match(/^(\d{6,20})(?::\d+)?@((?:hosted\.)?lid)$/);
    if (m) peerLid = `${m[1]}@${m[2]}`;
  }

  const sentAt = payload.sentAt ? new Date(payload.sentAt) : new Date();
  if (Number.isNaN(sentAt.getTime())) {
    return badRequest("sentAt must be a valid ISO timestamp");
  }

  // Attachment shape check. We only inspect the envelope; the actual base64
  // is opaque to us. Reject obviously malformed entries up front so we don't
  // partially ingest a message and partially reject the rest.
  const attachments = payload.attachments ?? [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") {
      return badRequest("attachments[] entries must be objects");
    }
    if (typeof a.fileName !== "string" || !a.fileName) {
      return badRequest("attachment.fileName required");
    }
    if (typeof a.mimeType !== "string" || !a.mimeType) {
      return badRequest("attachment.mimeType required");
    }
    if (typeof a.fileSize !== "number" || a.fileSize < 0) {
      return badRequest("attachment.fileSize must be a non-negative number");
    }
    if (typeof a.fileContentBase64 !== "string" || !a.fileContentBase64) {
      return badRequest("attachment.fileContentBase64 required");
    }
  }

  try {
    const result = await ingestInboundWhatsAppMessage({
      account,
      peerWaId,
      peerJid,
      peerLid,
      peerName: payload.peerName ?? null,
      body: payload.body,
      previewLabel: payload.previewLabel ?? null,
      externalMessageId: payload.externalMessageId,
      sentAt,
      toAddress: account.address,
      rawHeaders: { provider: "baileys", ...(payload.rawHeaders ?? {}) },
    });

    // Persist attachments only when we actually inserted a new message row.
    // On duplicate delivery (messageId === null) the original row's
    // attachments already exist — re-ingesting would double them up.
    if (result.messageId && attachments.length > 0) {
      for (const a of attachments) {
        try {
          await db.insert(inboxMessageAttachments).values({
            workspaceId: account.workspaceId,
            messageId: result.messageId,
            conversationId: result.conversationId,
            dealRecordId: result.dealRecordId,
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            fileContent: a.fileContentBase64,
            externalMediaId: a.externalMediaId ?? null,
          });
        } catch (attErr) {
          console.error(
            `[baileys-inbound] failed to store attachment for ${payload.externalMessageId}:`,
            attErr
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      conversationId: result.conversationId,
      dealRecordId: result.dealRecordId,
      messageId: result.messageId,
      isNewConversation: result.isNewConversation,
      attachmentsPersisted:
        result.messageId && attachments.length > 0 ? attachments.length : 0,
      duplicate: result.messageId === null && !result.isNewConversation ? true : undefined,
    });
  } catch (err) {
    console.error("[baileys-inbound] ingest failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest_failed" },
      { status: 500 }
    );
  }
}
