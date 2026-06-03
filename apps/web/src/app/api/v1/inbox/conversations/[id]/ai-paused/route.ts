import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { setConversationAiPaused } from "@/services/inbox";

/**
 * Per-conversation sales-agent toggle. Not admin-gated: whoever is working the
 * inbox (owner or partner) must be able to pause the agent on a thread they are
 * handling, and hand it back when done.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { aiPaused } = await req.json();
  if (typeof aiPaused !== "boolean") {
    return NextResponse.json({ error: "aiPaused must be boolean" }, { status: 400 });
  }

  const row = await setConversationAiPaused(id, ctx.workspaceId, aiPaused);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return success(row);
}
