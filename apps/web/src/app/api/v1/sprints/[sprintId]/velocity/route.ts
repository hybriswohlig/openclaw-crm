import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getSprintVelocity } from "@/services/sprints";

/**
 * GET /api/v1/sprints/[sprintId]/velocity
 *
 * Per-sprint velocity, derived burndown, and the last 5 closed sprints for
 * the velocity bar + a points forecast. Reuses the leaf-only / null-defaults
 * -to-1 rule from the Team-Pulse, just windowed by sprint dates. Does NOT
 * touch /api/v1/tasks/pulse (the Mon..Sun weekly view stays as-is).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { sprintId } = await params;
  try {
    const data = await getSprintVelocity(ctx.workspaceId, sprintId);
    if (!data) return notFound("Sprint not found");
    return success(data);
  } catch (err) {
    console.error("GET sprint velocity error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 }
    );
  }
}
