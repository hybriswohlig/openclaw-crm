/**
 * Portal signature state for one deal.
 *
 * GET /api/v1/deals/[recordId]/signature
 *
 * Read-only. Does not email or message the customer.
 */
import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getDealSignature } from "@/services/deal-signature";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  const state = await getDealSignature(ctx.workspaceId, recordId);
  if (!state) return notFound("Deal not found");
  return success(state);
}
