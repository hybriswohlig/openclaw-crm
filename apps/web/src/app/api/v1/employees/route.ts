import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listEmployees, createEmployee } from "@/services/employees";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const data = await listEmployees(ctx.workspaceId);
  return success(data);
}

const ALLOWED_STATUSES = new Set(["active", "on_leave", "inactive"] as const);

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, experience, hourlyRate, photoBase64, role, status } = body;

  if (!name || typeof name !== "string") {
    return badRequest("name is required");
  }
  if (!hourlyRate || isNaN(Number(hourlyRate))) {
    return badRequest("hourlyRate is required and must be a number");
  }
  if (status !== undefined && !ALLOWED_STATUSES.has(status)) {
    return badRequest("status must be one of active, on_leave, inactive");
  }

  const employee = await createEmployee(ctx.workspaceId, {
    name,
    experience,
    hourlyRate: String(hourlyRate),
    photoBase64: typeof photoBase64 === "string" ? photoBase64 : null,
    role: typeof role === "string" && role.trim() !== "" ? role.trim() : null,
    status: status as "active" | "on_leave" | "inactive" | undefined,
  });
  return success(employee, 201);
}
