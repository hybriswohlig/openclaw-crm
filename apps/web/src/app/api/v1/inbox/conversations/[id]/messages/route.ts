import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getMessages, markConversationRead } from "@/services/inbox";
import { sendEmailReply } from "@/services/inbox-email";

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

  try {
    const msg = await sendEmailReply({
      conversationId: id,
      workspaceId: ctx.workspaceId,
      body: body.trim(),
    });
    return success(msg);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
