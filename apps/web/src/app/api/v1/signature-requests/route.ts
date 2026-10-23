/**
 * Open and completed portal signature requests across deals.
 *
 * GET /api/v1/signature-requests?status=pending|signed|superseded|all
 *
 * Default status is pending. Does not email or message the customer.
 */
import { NextRequest } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { listSignatureRequests } from "@/services/deal-signature";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "signed", "superseded", "all"] as const;
type Status = (typeof STATUSES)[number];

function parseStatus(raw: string | null): Status | null {
  if (!raw) return "pending";
  return (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : null;
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const status = parseStatus(req.nextUrl.searchParams.get("status"));
  if (!status) return badRequest("status must be pending, signed, superseded or all");
  const result = await listSignatureRequests(ctx.workspaceId, status);
  return success(result);
}
