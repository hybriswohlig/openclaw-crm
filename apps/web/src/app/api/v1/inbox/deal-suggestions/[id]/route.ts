import { NextRequest, NextResponse } from "next/server";
import { badRequest, getAuthContext, unauthorized } from "@/lib/api-utils";
import { decideEmailDealSuggestion } from "@/services/email-lead-deals";

/**
 * POST /api/v1/inbox/deal-suggestions/{id}
 * Body: { "action": "accept" | "reject" }
 * Accept creates the deal. Nothing is sent to the customer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "accept" && body?.action !== "reject") {
    return badRequest("action must be accept or reject");
  }

  const result = await decideEmailDealSuggestion({
    workspaceId: ctx.workspaceId,
    suggestionId: id,
    action: body.action,
    userId: ctx.userId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.status === 404 ? "NOT_FOUND" : "CONFLICT", message: result.error } },
      { status: result.status }
    );
  }
  return NextResponse.json({ data: { applied: result.applied, dealRecordId: result.dealRecordId } });
}
