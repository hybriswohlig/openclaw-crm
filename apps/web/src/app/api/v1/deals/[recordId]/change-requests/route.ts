/**
 * Customer change requests already stored by the portal
 * (Änderung anfragen, Terminänderung, Schadenmeldung).
 *
 * GET /api/v1/deals/[recordId]/change-requests?status=open|handled|all
 *
 * Does not email or message the customer.
 */
import { NextRequest } from "next/server";
import { badRequest, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { listDealChangeRequests } from "@/services/deal-change-requests";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "handled", "all"] as const;
type Status = (typeof STATUSES)[number];

function parseStatus(raw: string | null): Status | null {
  if (!raw) return "all";
  return (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  const status = parseStatus(req.nextUrl.searchParams.get("status"));
  if (!status) return badRequest("status must be open, handled or all");
  const requests = await listDealChangeRequests(ctx.workspaceId, recordId, status);
  if (!requests) return notFound("Deal not found");
  return success({ requests });
}
