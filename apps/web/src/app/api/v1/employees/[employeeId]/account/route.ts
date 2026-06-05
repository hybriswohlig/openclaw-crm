import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { createEmployeeAccount } from "@/services/employee-accounts";

const PORTAL_BASE =
  process.env.EMPLOYEE_PORTAL_URL || "https://kottke-mitarbeiter.mimren.com";

/**
 * Create a portal login for an employee. Available to any approved CRM user
 * (not only app admins), scoped to their workspace.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { employeeId } = await params;
  const { username } = await req.json();
  if (!username) return badRequest("Username erforderlich.");
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
