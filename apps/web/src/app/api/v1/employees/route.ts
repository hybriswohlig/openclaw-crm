import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listEmployees, createEmployee } from "@/services/employees";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const data = await listEmployees(ctx.workspaceId);
  return success(data);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, experience, hourlyRate, photoBase64 } = body;

  if (!name || typeof name !== "string") {
    return badRequest("name is required");
  }
  if (!hourlyRate || isNaN(Number(hourlyRate))) {
    return badRequest("hourlyRate is required and must be a number");
  }

  const employee = await createEmployee(ctx.workspaceId, {
    name,
    experience,
    hourlyRate: String(hourlyRate),
    photoBase64: typeof photoBase64 === "string" ? photoBase64 : null,
  });
  return success(employee, 201);
}
