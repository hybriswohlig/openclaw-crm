import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import {
  getEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeContracts,
  getEmployeeDetailExtras,
} from "@/services/employees";

const ALLOWED_STATUSES = new Set(["active", "on_leave", "inactive"] as const);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { employeeId } = await params;
  const employee = await getEmployee(ctx.workspaceId, employeeId);
  if (!employee) return notFound("Employee not found");

  const [contracts, extras] = await Promise.all([
    getEmployeeContracts(ctx.workspaceId, employeeId),
    getEmployeeDetailExtras(ctx.workspaceId, employeeId),
  ]);
  return success({ ...employee, contracts, ...extras });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { employeeId } = await params;
  const body = await req.json();

  if (body.status !== undefined && !ALLOWED_STATUSES.has(body.status)) {
    return badRequest("status must be one of active, on_leave, inactive");
  }

  const patch: Parameters<typeof updateEmployee>[2] = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.experience !== undefined && { experience: body.experience }),
    ...(body.hourlyRate !== undefined && { hourlyRate: String(body.hourlyRate) }),
    ...(body.photoBase64 !== undefined && { photoBase64: body.photoBase64 }),
    ...(body.role !== undefined && {
      role:
        typeof body.role === "string" && body.role.trim() !== ""
          ? body.role.trim()
          : null,
    }),
    ...(body.status !== undefined && { status: body.status }),
  };

  const updated = await updateEmployee(ctx.workspaceId, employeeId, patch);
  if (!updated) return notFound("Employee not found");

  return success(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { employeeId } = await params;
  const deleted = await deleteEmployee(ctx.workspaceId, employeeId);
  if (!deleted) return notFound("Employee not found");

  return success(deleted);
}
