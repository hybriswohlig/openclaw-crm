import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getEmployeeLiabilities } from "@/services/employees";

/**
 * Workspace-wide employee liabilities (cumulative, not month-filtered):
 * what we owe all employees, per company and per employee.
 * Used by the Finanzen overview.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const data = await getEmployeeLiabilities(ctx.workspaceId);
  return success(data);
}
