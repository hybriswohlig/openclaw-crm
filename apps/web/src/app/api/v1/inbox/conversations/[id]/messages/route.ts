import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { channelAccounts, inboxConversations } from "@/db/schema/inbox";
import { and, eq } from "drizzle-orm";
import { getMessages, markConversationRead } from "@/services/inbox";
import { sendEmailReply } from "@/services/inbox-email";
import {
  sendWhatsAppReply,
  WhatsAppSessionExpiredError,
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

  // Resolve channel type from the conversation's channel account so the
  // right send path is chosen. This is the single enforcement point — the
  // UI never gets to pick an account directly.
  const [row] = await db
    .select({ channelType: channelAccounts.channelType })
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
    const msg =
      row.channelType === "whatsapp"
        ? await sendWhatsAppReply({
            conversationId: id,
            workspaceId: ctx.workspaceId,
            body: body.trim(),
          })
        : await sendEmailReply({
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
