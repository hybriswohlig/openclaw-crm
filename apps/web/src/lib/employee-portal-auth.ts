import { headers as nextHeaders } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { employees } from "@/db/schema";

// Authorization for the mobile employee portal. An "employee" is any logged-in
// better-auth user that a row in `employees` links to (employees.user_id). That
// link is the gate: only such users can reach portal data, and only their own.

export interface EmployeePortalContext {
  userId: string;
  employeeId: string;
  employeeName: string;
  workspaceId: string;
  hourlyRate: string;
  photoBase64: string | null;
}

async function resolveFromUserId(userId: string): Promise<EmployeePortalContext | null> {
  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.userId, userId))
    .limit(1);
  if (!emp) return null;
  return {
    userId,
    employeeId: emp.id,
    employeeName: emp.name,
    workspaceId: emp.workspaceId,
    hourlyRate: emp.hourlyRate,
    photoBase64: emp.photoBase64,
  };
}

/** For server components / pages (uses Next's request headers). */
export async function getEmployeePortalContext(): Promise<EmployeePortalContext | null> {
  const session = await auth.api.getSession({ headers: await nextHeaders() });
  if (!session?.user?.id) return null;
  return resolveFromUserId(session.user.id);
}

/** For route handlers (pass the incoming request's headers). */
export async function getEmployeePortalContextFromHeaders(
  reqHeaders: Headers
): Promise<EmployeePortalContext | null> {
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user?.id) return null;
  return resolveFromUserId(session.user.id);
}
