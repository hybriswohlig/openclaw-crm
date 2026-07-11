import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employeeTimeEntries, dealEmployees } from "@/db/schema";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, badRequest, success } from "@/lib/api-utils";
import { berlinDateString } from "@/lib/berlin-date";

/** GET: the currently running (open) time entry for this employee, if any. */
export async function GET(req: NextRequest) {
  const ctx = await getEmployeePortalContextFromHeaders(req.headers);
  if (!ctx) return unauthorized();
  const [open] = await db
    .select()
    .from(employeeTimeEntries)
    .where(
      and(
        eq(employeeTimeEntries.employeeId, ctx.employeeId),
        isNull(employeeTimeEntries.endAt)
      )
    )
    .limit(1);
  return success(open ?? null);
}

/** POST: clock in. Body: { dealRecordId }. Refuses if a session is already open. */
export async function POST(req: NextRequest) {
  const ctx = await getEmployeePortalContextFromHeaders(req.headers);
  if (!ctx) return unauthorized();
  const { dealRecordId } = await req.json();
  if (!dealRecordId) return badRequest("dealRecordId required");

  // Must be assigned to the deal.
  const [assigned] = await db
    .select({ id: dealEmployees.id })
    .from(dealEmployees)
    .where(
      and(
        eq(dealEmployees.dealRecordId, dealRecordId),
        eq(dealEmployees.employeeId, ctx.employeeId)
      )
    )
    .limit(1);
  if (!assigned) return badRequest("Nicht diesem Auftrag zugewiesen.");

  // One running session at a time.
  const [open] = await db
    .select({ id: employeeTimeEntries.id })
    .from(employeeTimeEntries)
    .where(
      and(
        eq(employeeTimeEntries.employeeId, ctx.employeeId),
        isNull(employeeTimeEntries.endAt)
      )
    )
    .limit(1);
  if (open) return badRequest("Es läuft bereits eine Zeiterfassung.");

  const now = new Date();
  const [row] = await db
    .insert(employeeTimeEntries)
    .values({
      workspaceId: ctx.workspaceId,
      dealRecordId,
      employeeId: ctx.employeeId,
      date: berlinDateString(now),
      startAt: now,
      status: "open",
    })
    .returning();
  return success(row, 201);
}
