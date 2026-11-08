import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { centAusHourlyRate } from "@/lib/einsatz";
import { listEmployees, createEmployee } from "@/services/employees";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const data = await listEmployees(ctx.workspaceId);
  return success(data);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const body = await req.json();
  const { name, experience, hourlyRate, photoBase64 } = body;

  if (!name || typeof name !== "string") {
    return badRequest("name is required");
  }
  if (hourlyRate === undefined || hourlyRate === null || hourlyRate === "") {
    return badRequest("hourlyRate is required and must be a number");
  }
  if (centAusHourlyRate(hourlyRate) === null) {
    return badRequest("hourlyRate ungültig");
  }

  try {
    const employee = await createEmployee(ctx.workspaceId, {
      name,
      experience,
      hourlyRate: String(hourlyRate),
      photoBase64: typeof photoBase64 === "string" ? photoBase64 : null,
    });
    return success(employee, 201);
  } catch (e) {
    if (e instanceof Error && e.message === "hourlyRate ungültig") return badRequest("hourlyRate ungültig");
    throw e;
  }
}
