import { NextRequest, NextResponse } from "next/server";
import { badRequest, getAuthContext, unauthorized } from "@/lib/api-utils";
import { decideDealEnrichmentSuggestion } from "@/services/deal-enrichment";

/**
 * POST /api/v1/deals/{recordId}/enrichment-suggestions/{suggestionId}
 * Body: { "action": "accept" | "reject" }
 * One click for the team. Also callable via the existing crm_api tool.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; suggestionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId, suggestionId } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "accept" && body?.action !== "reject") {
    return badRequest("action must be accept or reject");
  }

  const result = await decideDealEnrichmentSuggestion({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    suggestionId,
    action: body.action,
    userId: ctx.userId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.status === 404 ? "NOT_FOUND" : "CONFLICT", message: result.error } },
      { status: result.status }
    );
  }
  return NextResponse.json({ data: { applied: result.applied } });
}
