import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, isReadOnlyApiKey, unauthorized, success } from "@/lib/api-utils";
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
  BaileysMediaTooLargeError,
} from "@/services/inbox-whatsapp";
import { sendConversationDocuments } from "@/services/baileys-document-send";
import {
  WhatsAppDocumentInputError,
  parseWhatsAppSendPayload,
} from "@/services/whatsapp-document";
import { setHumanOwned } from "@/services/agent/agent-gate";
import { supersedePendingDrafts } from "@/services/agent/draft-schliessen";

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
      dealRecordId: inboxConversations.dealRecordId,
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

  if (parsed.attachments.length > 0) {
    const baileys =
      row.channelType === "whatsapp" &&
      !row.waPhoneNumberId &&
      row.baileysBridgeProvider === "inhouse";
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
    if (parsed.attachments.length > 0) {
      const sent = await sendConversationDocuments({
        conversationId: id,
        workspaceId: ctx.workspaceId,
        dealRecordId: row.dealRecordId,
        body,
        attachments: parsed.attachments,
        bodyDelivery: parsed.bodyDelivery,
        idempotencyKey: parsed.idempotencyKey,
      });
      msg = { ...sent.message, deduped: sent.deduped, messages: sent.messages };
    } else if (row.channelType === "whatsapp") {
      if (row.waPhoneNumberId) {
        msg = await sendWhatsAppReply({
          conversationId: id,
          workspaceId: ctx.workspaceId,
          body: body.trim(),
        });
      } else if (row.baileysBridgeProvider === "inhouse") {
        msg = await sendBaileysReply({
          conversationId: id,
          workspaceId: ctx.workspaceId,
          body: body.trim(),
        });
      } else {
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
    } else {
      msg = await sendEmailReply({
        conversationId: id,
        workspaceId: ctx.workspaceId,
        body: body.trim(),
      });
    }

    // A human just replied on this thread. Hand it to the human: stop the sales
    // agent here until it is explicitly handed back via the per-conversation
    // toggle. The shared send services do not touch aiNeedsReply/aiPaused (only
    // the WABA echo path clears aiNeedsReply), so we do it here. The agent's own
    // sends go through the service functions directly, not this route, so they
    // never trigger this pause.
    await db
      .update(inboxConversations)
      .set({ aiPaused: true, aiNeedsReply: false, updatedAt: new Date() })
      .where(
        and(
          eq(inboxConversations.id, id),
          eq(inboxConversations.workspaceId, ctx.workspaceId)
        )
      );

    // The human just wrote the reply. Retire pending drafts on this thread
    // and this deal so a later approve_and_send cannot double-send. Match
    // either id: a draft may be linked to the conversation, the deal, or both.
    try {
      await supersedePendingDrafts({
        workspaceId: ctx.workspaceId,
        conversationId: id,
        dealRecordId: row.dealRecordId,
        userId: ctx.userId,
        supersededBy: "manual_send",
      });
    } catch (draftErr) {
      console.error(
        "[inbox] supersede drafts after manual send failed (non-fatal):",
        draftErr
      );
    }

    // Sticky human ownership (deal-level, docs/ai-sales-agent-plan.md): a
    // manual composer send is a human takeover of the DEAL — mute the agent
    // until an explicit release via /api/v1/agent-state/release. Best-effort:
    // a successful send must never fail because of this bookkeeping.
    if (row.dealRecordId) {
      try {
        await setHumanOwned(ctx.workspaceId, row.dealRecordId, ctx.userId);
      } catch (ownErr) {
        console.error(
          "[inbox] setHumanOwned after manual send failed (non-fatal):",
          ownErr
        );
      }
    }

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
