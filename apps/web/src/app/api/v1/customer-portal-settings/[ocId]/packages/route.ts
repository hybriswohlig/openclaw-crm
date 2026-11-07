/**
 * GET  /api/v1/customer-portal-settings/[ocId]/packages    — list packages
 * POST /api/v1/customer-portal-settings/[ocId]/packages    — create package
 *
 * Plan 5b: `hebel` (Liste aus halteverbot, montage, einpacken, kueche) legt
 * fest, welche Leistungen der Paketpreis über den Kern hinaus enthält.
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
  notFound,
} from "@/lib/api-utils";
import { hebelAusEingabe } from "@/lib/paket-hebel";
import {
  createOfferPackage,
  listOfferPackages,
  operatingCompanyInWorkspace,
  type OfferPackageInput,
} from "@/services/customer-portal-config";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
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
  if (!ctx) return unauthorized(req);
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { ocId } = await params;

  let body: OfferPackageInput;
  try {
    body = (await req.json()) as OfferPackageInput;
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Ungültiges Paket.");
  if (typeof body.slug !== "string" || typeof body.displayName !== "string" || !body.slug.trim() || !body.displayName.trim()) {
    return badRequest("slug and displayName are required");
  }
  const hebel = hebelAusEingabe((body as { hebel?: unknown }).hebel);
  if (hebel === null) return badRequest("hebel: nur halteverbot, montage, einpacken, kueche.");
  if (!(await operatingCompanyInWorkspace(ctx.workspaceId, ocId))) return notFound();
  body = { ...body, ...(hebel !== undefined ? { hebel } : {}) };
  const row = await createOfferPackage(ctx.workspaceId, ocId, body);
  if (!row) return badRequest("Could not create package");
  return success(row, 201);
}
