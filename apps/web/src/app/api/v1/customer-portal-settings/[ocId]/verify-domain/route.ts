/**
 * POST /api/v1/customer-portal-settings/[ocId]/verify-domain
 *   → runs DNS + (optional) Vercel verification, persists state, returns report.
 *
 * Admin-only. Triggered by the "Verify" button in the settings UI.
 */
import { NextRequest } from "next/server";
import {
  getAuthContext,
  requireAdmin,
  unauthorized,
  notFound,
  success,
} from "@/lib/api-utils";
import { verifyOperatingCompanyDomain } from "@/services/customer-portal-config";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const { ocId } = await params;
  const report = await verifyOperatingCompanyDomain(ctx.workspaceId, ocId);
  if (!report) return notFound("No domain to verify");
  return success(report);
}
