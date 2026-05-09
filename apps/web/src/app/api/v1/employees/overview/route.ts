import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getEmployeeOverview } from "@/services/employee-overview";

/**
 * GET /api/v1/employees/overview
 *
 * Returns one row per employee with the v1 team-dashboard fields (KOT-589):
 * jobs/hours this month, paid YTD, owed now, avg rating, on-time %, last
 * job date. Fields without underlying data come back as `null` (rating,
 * on-time %) so the UI can show `—` instead of a fake zero.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const rows = await getEmployeeOverview(ctx.workspaceId);
  return success(rows);
}
