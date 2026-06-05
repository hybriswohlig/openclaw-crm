import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeTimeEntries } from "@/db/schema";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, notFound, badRequest, success } from "@/lib/api-utils";

/**
 * PATCH a time entry the employee owns. Body may set:
 *  - action: "stop"   → set end_at = now, status = submitted
 *  - addBreakMinutes  → add to break_minutes
 *  - notes
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getEmployeePortalContextFromHeaders(req.headers);
  if (!ctx) return unauthorized();
  const { id } = await params;

  const [entry] = await db
    .select()
    .from(employeeTimeEntries)
    .where(
      and(
        eq(employeeTimeEntries.id, id),
        eq(employeeTimeEntries.employeeId, ctx.employeeId)
      )
    )
    .limit(1);
  if (!entry) return notFound("Zeiteintrag nicht gefunden");
  if (entry.status === "approved") return badRequest("Bereits freigegeben.");

  const body = await req.json();
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (body.action === "stop") {
    set.endAt = new Date();
    set.status = "submitted";
  }
  if (typeof body.addBreakMinutes === "number" && body.addBreakMinutes > 0) {
    set.breakMinutes = entry.breakMinutes + Math.round(body.addBreakMinutes);
  }
  if (typeof body.breakMinutes === "number" && body.breakMinutes >= 0) {
    set.breakMinutes = Math.round(body.breakMinutes);
  }
  if (typeof body.notes === "string") set.notes = body.notes;

  const [row] = await db
    .update(employeeTimeEntries)
    .set(set)
    .where(eq(employeeTimeEntries.id, id))
    .returning();
  return success(row);
}
