import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { listDealEnrichmentSuggestions } from "@/services/deal-enrichment";

/** GET /api/v1/deals/{recordId}/enrichment-suggestions?status=pending */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const suggestions = await listDealEnrichmentSuggestions(ctx.workspaceId, {
    dealRecordId: recordId,
    status,
  });
  return success(suggestions);
}
