import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { unassignEmployeeFromDeal, updateDealEmployeeRole } from "@/services/employees";

const VALID_ROLES = ["helper", "lead"];

/** Change an assignment's role — used to promote a helper to job lead. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; assignmentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId, assignmentId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound();
  const { role } = await req.json();
  if (!VALID_ROLES.includes(role)) return badRequest("role must be helper or lead");

  const row = await updateDealEmployeeRole(recordId, assignmentId, role);
  if (!row) return notFound("Assignment not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; assignmentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId, assignmentId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound();
  const deleted = await unassignEmployeeFromDeal(assignmentId, recordId);
  if (!deleted) return notFound("Assignment not found");

  return success(deleted);
}
