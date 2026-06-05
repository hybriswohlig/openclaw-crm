import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { unassignEmployeeFromDeal } from "@/services/employees";
import { db } from "@/db";
import { dealEmployees } from "@/db/schema";

const VALID_ROLES = ["helper", "lead"];

/** Change an assignment's role — used to promote a helper to job lead. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { assignmentId } = await params;
  const { role } = await req.json();
  if (!VALID_ROLES.includes(role)) return badRequest("role must be helper or lead");

  const [row] = await db
    .update(dealEmployees)
    .set({ role })
    .where(eq(dealEmployees.id, assignmentId))
    .returning();
  if (!row) return notFound("Assignment not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { assignmentId } = await params;
  const deleted = await unassignEmployeeFromDeal(assignmentId);
  if (!deleted) return notFound("Assignment not found");

  return success(deleted);
}
