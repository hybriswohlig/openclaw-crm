/**
 * GET  /api/v1/customer-portal-settings/[ocId]/packages    — list packages
 * POST /api/v1/customer-portal-settings/[ocId]/packages    — create package
 *
 * Admin-only. Lives under the existing customer-portal-settings tree so the
 * UI fetches stay short.
 */
import { NextRequest } from "next/server";
import {
  getAuthContext,
  requireAdmin,
  unauthorized,
  success,
  badRequest,
} from "@/lib/api-utils";
import {
  createOfferPackage,
  listOfferPackages,
  type OfferPackageInput,
} from "@/services/customer-portal-config";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { ocId } = await params;
  const rows = await listOfferPackages(ctx.workspaceId, ocId);
  return success(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { ocId } = await params;

  let body: OfferPackageInput;
  try {
    body = (await req.json()) as OfferPackageInput;
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!body.slug?.trim() || !body.displayName?.trim()) {
    return badRequest("slug and displayName are required");
  }
  const row = await createOfferPackage(ctx.workspaceId, ocId, body);
  if (!row) return badRequest("Could not create package");
  return success(row, 201);
}
