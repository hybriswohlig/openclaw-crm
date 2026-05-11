import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { channelAccounts, inboxConversations } from "@/db/schema/inbox";
import { and, eq } from "drizzle-orm";
import { getMessages, markConversationRead } from "@/services/inbox";
import { sendEmailReply } from "@/services/inbox-email";
import {
  sendWhatsAppReply,
  sendBaileysReply,
  WhatsAppSessionExpiredError,
  BaileysBridgeNotConfiguredError,
  BaileysBridgeError,
} from "@/services/inbox-whatsapp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const msgs = await getMessages(id, ctx.workspaceId);
  await markConversationRead(id, ctx.workspaceId);
  return success(msgs);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { body } = await req.json();

  if (!body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  // Resolve channel type + bridge from the conversation's channel account
  // so the right send path is chosen. This is the single enforcement point
  // — the UI never gets to pick an account directly.
  //
  // Three-way routing inside WhatsApp:
  //   waPhoneNumberId IS NOT NULL                     → WABA Cloud API
  //   waPhoneNumberId IS NULL && provider='inhouse'   → in-house Baileys bridge
  //   waPhoneNumberId IS NULL && provider='openclaw'  → OpenClaw (no outbound yet)
  const [row] = await db
    .select({
      channelType: channelAccounts.channelType,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(
      and(
        eq(inboxConversations.id, id),
        eq(inboxConversations.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    if (row.channelType === "whatsapp") {
      if (row.waPhoneNumberId) {
        const msg = await sendWhatsAppReply({
          conversationId: id,
          workspaceId: ctx.workspaceId,
          body: body.trim(),
        });
        return success(msg);
      }
      if (row.baileysBridgeProvider === "inhouse") {
        const msg = await sendBaileysReply({
          conversationId: id,
          workspaceId: ctx.workspaceId,
          body: body.trim(),
        });
        return success(msg);
      }
      // OpenClaw — outbound not implemented through the CRM yet.
      return NextResponse.json(
        {
          error: {
            code: "OPENCLAW_OUTBOUND_NOT_IMPLEMENTED",
            message:
              "This WhatsApp number is bridged via OpenClaw, which does not expose outbound to the CRM. Switch this account to the in-house bridge in Integrations to send replies from here.",
          },
        },
        { status: 501 }
      );
    }
    const msg = await sendEmailReply({
      conversationId: id,
      workspaceId: ctx.workspaceId,
      body: body.trim(),
    });
    return success(msg);
  } catch (err) {
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
