import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import {
  sendBaileysFirstMessage,
  BaileysMediaTooLargeError,
  BaileysBridgeError,
  BaileysBridgeNotConfiguredError,
} from "@/services/inbox-whatsapp";
import { sendBaileysOpeningDocuments } from "@/services/baileys-document-send";
import {
  WhatsAppDocumentInputError,
  parseWhatsAppSendPayload,
} from "@/services/whatsapp-document";
import { supersedePendingDrafts } from "@/services/agent/draft-schliessen";

export const maxDuration = 60;

/**
 * First-contact send for personal-WhatsApp (Baileys) channel accounts.
 * The WABA composer opens conversations with approved templates; Baileys has
 * no template requirement, so this route accepts a free-form text body.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const payload = await req.json().catch(() => ({}));
  const { channelAccountId, toPhone, customerName, dealRecordId } = payload as {
    channelAccountId?: string;
    toPhone?: string;
    customerName?: string;
    dealRecordId?: string | null;
  };
  let parsed;
  try {
    parsed = parseWhatsAppSendPayload(payload);
  } catch (err) {
    if (err instanceof WhatsAppDocumentInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return badRequest("Invalid JSON body");
  }

  if (!channelAccountId || !toPhone || (!parsed.body && parsed.attachments.length === 0)) {
    return badRequest("channelAccountId, toPhone, and body or attachments are required");
  }

  try {
    const linkedDeal = typeof dealRecordId === "string" ? dealRecordId : null;
    const result = parsed.attachments.length
      ? await sendBaileysOpeningDocuments({
          workspaceId: ctx.workspaceId,
          channelAccountId,
          toPhone,
          customerName: customerName ?? "",
          body: parsed.body,
          dealRecordId: linkedDeal,
          attachments: parsed.attachments,
          bodyDelivery: parsed.bodyDelivery,
          idempotencyKey: parsed.idempotencyKey,
        })
      : await sendBaileysFirstMessage({
          workspaceId: ctx.workspaceId,
          channelAccountId,
          toPhone,
          customerName: customerName ?? "",
          body: parsed.body,
          dealRecordId: linkedDeal,
        });
    const conversationId = result.conversationId;
    // First-contact drafts often have no conversation yet and hang off the
    // deal. Close both so approve_and_send cannot send the draft afterwards.
    try {
      await supersedePendingDrafts({
        workspaceId: ctx.workspaceId,
        conversationId,
        dealRecordId: linkedDeal,
        userId: ctx.userId,
        supersededBy: "manual_send",
      });
    } catch (draftErr) {
      console.error(
        "[inbox] supersede drafts after baileys first send failed (non-fatal):",
        draftErr
      );
    }
    return success({
      conversationId,
      ...(parsed.attachments.length
        ? {
            deduped: "deduped" in result ? result.deduped : false,
            messageId: "message" in result ? result.message?.id ?? null : null,
          }
        : {}),
    });
  } catch (err) {
    if (err instanceof WhatsAppDocumentInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof BaileysMediaTooLargeError) {
      return NextResponse.json(
        { error: { code: "BAILEYS_MEDIA_TOO_LARGE", message: err.message } },
        { status: 413 }
      );
    }
    if (err instanceof BaileysBridgeNotConfiguredError) {
      return NextResponse.json(
        { error: { code: "BAILEYS_BRIDGE_NOT_CONFIGURED", message: err.message } },
        { status: 503 }
      );
    }
    if (err instanceof BaileysBridgeError) {
      return NextResponse.json(
        { error: { code: "BAILEYS_BRIDGE_ERROR", status: err.status, message: err.message } },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
