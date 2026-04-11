import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { updateConversationStatus } from "@/services/inbox";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { status } = await req.json();

  const valid = ["open", "resolved", "spam"];
  if (!valid.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const row = await updateConversationStatus(id, ctx.workspaceId, status);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return success(row);
}
