import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { createEmployeeAccount, listEmployeeAccounts } from "@/services/employee-accounts";

const PORTAL_BASE =
  process.env.EMPLOYEE_PORTAL_URL || "https://kottke-mitarbeiter.mimren.com";

/** List employees with their portal-account status. */
export async function GET(req: NextRequest) {
  const admin = await getAppAdminFromRequest(req);
  const ctx = await getAuthContext(req);
  if (!admin || !ctx) return unauthorized();
  const list = await listEmployeeAccounts(ctx.workspaceId);
  return success(list);
}

/** Create a login for an employee. Returns the one-time setup link. */
export async function POST(req: NextRequest) {
  const admin = await getAppAdminFromRequest(req);
  const ctx = await getAuthContext(req);
  if (!admin || !ctx) return unauthorized();

  const { employeeId, username } = await req.json();
  if (!employeeId || !username) return badRequest("employeeId und username erforderlich.");
  try {
    const { userId, username: uname, setupToken } = await createEmployeeAccount(
      ctx.workspaceId,
      employeeId,
      username
    );
    return success(
      {
        userId,
        username: uname,
        setupUrl: `${PORTAL_BASE}/passwort-setzen?token=${setupToken}`,
      },
      201
    );
  } catch (err) {
    return badRequest((err as Error).message);
  }
}
