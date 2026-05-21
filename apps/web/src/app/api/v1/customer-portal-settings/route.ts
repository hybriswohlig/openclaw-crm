/**
 * GET /api/v1/customer-portal-settings
 *   → list of operating-company portal-settings rows for the current workspace.
 *
 * Admin-only.
 */
import { NextRequest } from "next/server";
import { getAuthContext, requireAdmin, unauthorized, success } from "@/lib/api-utils";
import { listOperatingCompanyPortalSettings } from "@/services/customer-portal-config";
import { isConfigured as vercelApiConfigured } from "@/services/vercel-domains";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const rows = await listOperatingCompanyPortalSettings(ctx.workspaceId);
  return success({
    operatingCompanies: rows,
    vercelIntegrationAvailable: vercelApiConfigured(),
  });
}
