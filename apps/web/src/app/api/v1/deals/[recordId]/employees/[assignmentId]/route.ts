import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { unassignEmployeeFromDeal } from "@/services/employees";

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
