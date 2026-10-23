/**
 * Mark one portal change request as handled.
 *
 * PATCH /api/v1/deals/[recordId]/change-requests/[requestId]
 *
 * Idempotent. Does not email or message the customer.
 */
import { NextRequest } from "next/server";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { resolveDealChangeRequest } from "@/services/deal-change-requests";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; requestId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, requestId } = await params;
  const result = await resolveDealChangeRequest({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    requestId,
    userId: ctx.userId,
  });
  if (!result) return notFound("Change request not found");
  return success(result);
}
