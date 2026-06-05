import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { resetEmployeePassword } from "@/services/employee-accounts";

const PORTAL_BASE =
  process.env.EMPLOYEE_PORTAL_URL || "https://kottke-mitarbeiter.mimren.com";

/** Re-issue a one-time setup link (password reset) for an employee account. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const admin = await getAppAdminFromRequest(req);
  const ctx = await getAuthContext(req);
  if (!admin || !ctx) return unauthorized();
  const { employeeId } = await params;
  try {
    const { setupToken } = await resetEmployeePassword(ctx.workspaceId, employeeId);
    return success({ setupUrl: `${PORTAL_BASE}/passwort-setzen?token=${setupToken}` });
  } catch (err) {
    return badRequest((err as Error).message);
  }
}
