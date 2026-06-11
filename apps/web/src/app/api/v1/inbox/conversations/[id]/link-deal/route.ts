import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest, notFound } from "@/lib/api-utils";
import { linkConversationToDeal } from "@/services/inbox";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { dealRecordId } = await req.json();

  if (typeof dealRecordId !== "string" || !dealRecordId.trim()) {
    return badRequest("dealRecordId fehlt");
  }

  const result = await linkConversationToDeal(id, ctx.workspaceId, dealRecordId.trim());
  if ("error" in result) {
    return notFound(
      result.error === "deal_not_found"
        ? "Deal nicht gefunden"
        : "Konversation nicht gefunden"
    );
  }
  return success(result.conversation);
}
