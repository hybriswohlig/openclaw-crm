import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { listDealEnrichmentSuggestions } from "@/services/deal-enrichment";

/**
 * GET /api/v1/deals/enrichment-suggestions?status=pending
 * Open KI suggestions across deals. Reachable through crm_api; no dedicated MCP tool.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const suggestions = await listDealEnrichmentSuggestions(ctx.workspaceId, { status });
  return success(suggestions);
}
