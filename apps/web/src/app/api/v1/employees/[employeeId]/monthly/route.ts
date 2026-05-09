import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getEmployee } from "@/services/employees";
import { getEmployeeMonthlyBuckets } from "@/services/employee-overview";

/**
 * GET /api/v1/employees/{employeeId}/monthly
 *
 * Returns the last 12 months of (paid €, owed €) buckets for the
 * drill-down chart.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { employeeId } = await params;
  const exists = await getEmployee(ctx.workspaceId, employeeId);
  if (!exists) return notFound("Employee not found");

  const buckets = await getEmployeeMonthlyBuckets(ctx.workspaceId, employeeId, 12);
  return success(buckets);
}
