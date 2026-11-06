import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, isReadOnlyApiKey, unauthorized, success } from "@/lib/api-utils";
import { getMessages, markConversationRead } from "@/services/inbox";
import {
  WhatsAppSessionExpiredError,
  BaileysBridgeNotConfiguredError,
  BaileysBridgeError,
  BaileysMediaTooLargeError,
} from "@/services/inbox-whatsapp";
import { sendConversationDocuments } from "@/services/baileys-document-send";
import {
  WhatsAppDocumentInputError,
  parseWhatsAppSendPayload,
} from "@/services/whatsapp-document";
import {
  GespraechNichtGefunden,
  OpenClawAusgehendFehler,
  ladeGespraechKanal,
  nachEigenerNachricht,
  sendeAntwort,
  type GespraechKanal,
} from "@/services/inbox-senden";

export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { id } = await params;
  const msgs = await getMessages(id, ctx.workspaceId);
  // Opening the thread marks it read for a person. A read-only key only fetches.
  if (!isReadOnlyApiKey(ctx)) {
    await markConversationRead(id, ctx.workspaceId);
  }
  return success(msgs);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { id } = await params;
  let parsed;
  try {
    parsed = parseWhatsAppSendPayload(await req.json());
  } catch (err) {
    if (err instanceof WhatsAppDocumentInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parsed.body;

  if (!body && parsed.attachments.length === 0) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  // Documents need the channel before anything else: they go out only through
  // the in-house Baileys bridge. Text resolves its channel in sendeAntwort, the
  // single enforcement point for the send path (the UI never picks an account).
  let kanal: GespraechKanal | null = null;
  if (parsed.attachments.length > 0) {
    kanal = await ladeGespraechKanal(ctx.workspaceId, id);
    if (!kanal) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const baileys =
      kanal.channelType === "whatsapp" &&
      !kanal.waPhoneNumberId &&
      kanal.baileysBridgeProvider === "inhouse";
    if (!baileys) {
      return NextResponse.json(
        {
          error: {
            code: "BAILEYS_DOCUMENTS_ONLY",
            message:
              "Document attachments on this endpoint are sent only through the in-house Baileys bridge.",
          },
        },
        { status: 400 }
      );
    }
  }

  try {
    let msg;
    let dealRecordId: string | null;
    if (kanal) {
      const sent = await sendConversationDocuments({
        conversationId: id,
        workspaceId: ctx.workspaceId,
        dealRecordId: kanal.dealRecordId,
        body,
        attachments: parsed.attachments,
        bodyDelivery: parsed.bodyDelivery,
        idempotencyKey: parsed.idempotencyKey,
      });
      msg = { ...sent.message, deduped: sent.deduped, messages: sent.messages };
      dealRecordId = kanal.dealRecordId;
    } else {
      const sent = await sendeAntwort({ workspaceId: ctx.workspaceId, conversationId: id, body });
      msg = sent.message;
      dealRecordId = sent.dealRecordId;
    }

    // A human just replied on this thread: pause the agent, note our own
    // message for Wartet (fresh sends only, with the persisted sent time),
    // retire pending drafts and take the deal over. See nachEigenerNachricht.
    await nachEigenerNachricht({
      workspaceId: ctx.workspaceId,
      conversationId: id,
      dealRecordId,
      userId: ctx.userId,
      sentAt: msg?.sentAt instanceof Date ? msg.sentAt : new Date(),
      deduped: !!msg && "deduped" in msg && msg.deduped === true,
    });

    return success(msg);
  } catch (err) {
    if (err instanceof GespraechNichtGefunden) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (err instanceof OpenClawAusgehendFehler) {
      // OpenClaw — outbound not implemented through the CRM yet.
      return NextResponse.json(
        { error: { code: "OPENCLAW_OUTBOUND_NOT_IMPLEMENTED", message: err.message } },
        { status: 501 }
      );
    }
    if (err instanceof WhatsAppSessionExpiredError) {
      return NextResponse.json(
        { error: { code: "WA_SESSION_EXPIRED", message: err.message } },
        { status: 409 }
      );
    }
    if (err instanceof BaileysBridgeNotConfiguredError) {
      return NextResponse.json(
        {
          error: {
            code: "BAILEYS_BRIDGE_NOT_CONFIGURED",
            message: err.message,
          },
        },
        { status: 503 }
      );
    }
    if (err instanceof WhatsAppDocumentInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof BaileysMediaTooLargeError) {
      return NextResponse.json(
        { error: { code: "BAILEYS_MEDIA_TOO_LARGE", message: err.message } },
        { status: 413 }
      );
    }
    if (err instanceof BaileysBridgeError) {
      return NextResponse.json(
        {
          error: {
            code: "BAILEYS_BRIDGE_ERROR",
            status: err.status,
            message: err.message,
          },
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
