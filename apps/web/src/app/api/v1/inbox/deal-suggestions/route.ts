import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { listEmailDealSuggestions } from "@/services/email-lead-deals";

/**
 * GET /api/v1/inbox/deal-suggestions?status=pending
 * "Deal anlegen" suggestions for conversations that do not have a deal yet.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const suggestions = await listEmailDealSuggestions(ctx.workspaceId, status);
  return success(suggestions);
}
