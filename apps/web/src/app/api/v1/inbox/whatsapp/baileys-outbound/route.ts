/**
 * Baileys WhatsApp outbound ingestion endpoint.
 *
 * Mirror of `/baileys-inbound`, but for messages the operator typed directly
 * on the linked WhatsApp Business app on their phone (not through the CRM).
 * Baileys forwards every `messages.upsert` event including `fromMe=true`; the
 * bridge filters those events to this route so the conversation timeline in
 * the CRM stays in sync with the actual phone.
 *
 * Idempotent on `(conversationId, externalMessageId)`. If the CRM's own send
 * pipeline already wrote a row with the same `externalMessageId` (because
 * the operator sent from the CRM web app and Baileys echoed it back), the
 * duplicate insert is swallowed silently by `ingestOutboundWhatsAppMessage`.
 *
 * Auth: Bearer token (api_keys table), same as `/baileys-inbound`.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts, inboxMessageAttachments } from "@/db/schema/inbox";
import { eq, and, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { ingestOutboundWhatsAppMessage } from "@/services/inbox-whatsapp";

export const dynamic = "force-dynamic";

interface BaileysOutboundAttachment {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContentBase64: string;
  externalMediaId?: string | null;
}

interface BaileysOutboundPayload {
  /** UUID of the channel_accounts row (channel_type='whatsapp', wa_phone_number_id IS NULL). */
  accountId: string;
  /** Recipient's WhatsApp ID (the customer). */
  peerWaId: string;
  /**
   * Full recipient JID (`123@lid` or `123@s.whatsapp.net`). Stored on the
   * conversation so the CRM's own outbound path can target the right
   * addressing mode on the next send. See `baileys-inbound/route.ts` for
   * details. Optional for backward compatibility.
   */
  peerJid?: string;
  /** Plain-text body (may be empty for media-only). */
  body: string;
  /** Optional preview label override for media-only messages. */
  previewLabel?: string | null;
  /** WhatsApp message key.id — also the dedup key. */
  externalMessageId: string;
  /** ISO timestamp of when the operator sent the message. Defaults to now. */
  sentAt?: string;
  /** Optional metadata preserved in raw_headers. */
  rawHeaders?: Record<string, unknown> | null;
  /** Inline attachments, already downloaded + base64-encoded by the bridge. */
  attachments?: BaileysOutboundAttachment[];
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let payload: BaileysOutboundPayload;
  try {
    payload = (await req.json()) as BaileysOutboundPayload;
  } catch {
    return badRequest("invalid_json");
  }

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

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, payload.accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
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

  const peerWaId = payload.peerWaId
    .replace(/@.*$/, "")
    .replace(/^\+/, "")
    .replace(/\s+/g, "");
  if (!/^\d{6,20}$/.test(peerWaId)) {
    return badRequest("peerWaId must be a digit-only E.164-like phone", {
      received: payload.peerWaId,
    });
  }

  let peerJid: string | null = null;
  if (typeof payload.peerJid === "string" && payload.peerJid) {
    const raw = payload.peerJid.replace(/\s+/g, "");
    if (!/^\+?\d{6,20}(?::\d+)?@(?:lid|s\.whatsapp\.net|c\.us|g\.us)$/.test(raw)) {
      return badRequest("peerJid must be a digits@domain JID", { received: payload.peerJid });
    }
    const at = raw.indexOf("@");
    const local = raw.slice(0, at).replace(/^\+/, "").replace(/:.*$/, "");
    peerJid = `${local}${raw.slice(at)}`;
  }

  const sentAt = payload.sentAt ? new Date(payload.sentAt) : new Date();
  if (Number.isNaN(sentAt.getTime())) {
    return badRequest("sentAt must be a valid ISO timestamp");
  }

  const attachments = payload.attachments ?? [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") return badRequest("attachments[] entries must be objects");
    if (typeof a.fileName !== "string" || !a.fileName) return badRequest("attachment.fileName required");
    if (typeof a.mimeType !== "string" || !a.mimeType) return badRequest("attachment.mimeType required");
    if (typeof a.fileSize !== "number" || a.fileSize < 0) return badRequest("attachment.fileSize must be a non-negative number");
    if (typeof a.fileContentBase64 !== "string" || !a.fileContentBase64) return badRequest("attachment.fileContentBase64 required");
  }

  try {
    const result = await ingestOutboundWhatsAppMessage({
      account,
      peerWaId,
      peerJid,
      body: payload.body,
      previewLabel: payload.previewLabel ?? null,
      externalMessageId: payload.externalMessageId,
      sentAt,
      rawHeaders: { provider: "baileys", source: "phone-direct", ...(payload.rawHeaders ?? {}) },
    });

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
            `[baileys-outbound] failed to store attachment for ${payload.externalMessageId}:`,
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
      attachmentsPersisted: result.messageId && attachments.length > 0 ? attachments.length : 0,
      // messageId === null + !isNewConversation = duplicate echo (CRM-sent + bridge-echoed same id)
      duplicate: result.messageId === null && !result.isNewConversation ? true : undefined,
    });
  } catch (err) {
    console.error("[baileys-outbound] ingest failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest_failed" },
      { status: 500 }
    );
  }
}
