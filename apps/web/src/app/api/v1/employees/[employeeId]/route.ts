import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { centAusHourlyRate, SATZ_CENT_MAX, SATZ_CENT_MIN } from "@/lib/einsatz";
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
  if (!ctx) return unauthorized(req);

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
  if (!ctx) return unauthorized(req);

  const { employeeId } = await params;
  const body = await req.json();
  const rate = body && typeof body === "object" ? (body as { hourlyRate?: unknown }).hourlyRate : undefined;
  if (rate !== undefined) {
    const cent = centAusHourlyRate(rate as string | number | null);
    // Review M7: 0 € und zu große Sätze (int-Überlauf) gibt es nicht.
    if (cent === null || cent < SATZ_CENT_MIN || cent > SATZ_CENT_MAX) return badRequest("hourlyRate ungültig (1 bis 200 € je Stunde)");
  }

  try {
    const updated = await updateEmployee(ctx.workspaceId, employeeId, body);
    if (!updated) return notFound("Employee not found");
    return success(updated);
  } catch (e) {
    if (e instanceof Error && e.message === "hourlyRate ungültig") return badRequest("hourlyRate ungültig");
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { employeeId } = await params;
  const deleted = await deleteEmployee(ctx.workspaceId, employeeId);
  if (!deleted) return notFound("Employee not found");

  return success(deleted);
}
