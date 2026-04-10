import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listDealEmployees, assignEmployeeToDeal } from "@/services/employees";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listDealEmployees(recordId);
  return success(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const body = await req.json();
  const { employeeId, role } = body;

  if (!employeeId) {
    return badRequest("employeeId is required");
  }

  const assignment = await assignEmployeeToDeal(recordId, employeeId, role || "helper");
  return success(assignment, 201);
}
