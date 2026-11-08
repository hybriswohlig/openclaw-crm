import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, notFound, success } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { listDealEmployees, assignEmployeeToDeal, getEmployee } from "@/services/employees";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound();
  const data = await listDealEmployees(recordId);
  return success(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound();
  const body = await req.json();
  const { employeeId, role } = body;

  if (!employeeId) {
    return badRequest("employeeId is required");
  }
  if (!(await getEmployee(ctx.workspaceId, employeeId))) return notFound();

  const assignment = await assignEmployeeToDeal(recordId, employeeId, role || "helper");
  return success(assignment, 201);
}
