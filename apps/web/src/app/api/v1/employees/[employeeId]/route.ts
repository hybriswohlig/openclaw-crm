import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import {
  getEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeContracts,
  getEmployeeDetailExtras,
} from "@/services/employees";

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

  const updated = await updateEmployee(ctx.workspaceId, employeeId, body);
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
