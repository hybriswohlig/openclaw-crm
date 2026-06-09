import { NextRequest, NextResponse } from "next/server";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  success,
} from "@/lib/api-utils";
import { listSprints, createSprint } from "@/services/sprints";

/** GET /api/v1/sprints — all sprints for the workspace (newest first). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();
    const sprints = await listSprints(ctx.workspaceId);
    return success({ sprints });
  } catch (err) {
    console.error("GET /api/v1/sprints error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 }
    );
  }
}

/** POST /api/v1/sprints — create a sprint (starts in Planung). */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("name is required");

  try {
    const sprint = await createSprint(ctx.workspaceId, ctx.userId, {
      name,
      goal: typeof body.goal === "string" ? body.goal : null,
      startDate: typeof body.startDate === "string" ? body.startDate : null,
      endDate: typeof body.endDate === "string" ? body.endDate : null,
      capacityPoints:
        typeof body.capacityPoints === "number" ? body.capacityPoints : null,
    });
    return success(sprint, 201);
  } catch (err) {
    console.error("Failed to create sprint:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create sprint" } },
      { status: 500 }
    );
  }
}
