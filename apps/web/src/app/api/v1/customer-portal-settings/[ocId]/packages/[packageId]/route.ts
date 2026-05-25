/**
 * PATCH  /api/v1/customer-portal-settings/[ocId]/packages/[packageId]
 *   → update one package's fields.
 *
 * DELETE /api/v1/customer-portal-settings/[ocId]/packages/[packageId]
 *   → permanently delete. Existing quotations that referenced this slug
 *     keep working (quotations.selected_package_slug is just text).
 *
 * Admin-only.
 */
import { NextRequest } from "next/server";
import {
  getAuthContext,
  requireAdmin,
  unauthorized,
  notFound,
  success,
  badRequest,
} from "@/lib/api-utils";
import {
  deleteOfferPackage,
  updateOfferPackage,
  type OfferPackageInput,
} from "@/services/customer-portal-config";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string; packageId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { ocId, packageId } = await params;

  let body: Partial<OfferPackageInput>;
  try {
    body = (await req.json()) as Partial<OfferPackageInput>;
  } catch {
    return badRequest("Invalid JSON body");
  }
  const row = await updateOfferPackage(ctx.workspaceId, ocId, packageId, body);
  if (!row) return notFound("Package not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string; packageId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { ocId, packageId } = await params;
  const ok = await deleteOfferPackage(ctx.workspaceId, ocId, packageId);
  if (!ok) return notFound("Package not found");
  return success({ deleted: true });
}
