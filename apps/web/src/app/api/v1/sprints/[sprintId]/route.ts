import { NextRequest, NextResponse } from "next/server";
import {
  getAuthContext,
  unauthorized,
  notFound,
  badRequest,
  success,
} from "@/lib/api-utils";
import {
  getSprint,
  updateSprint,
  activateSprint,
  closeSprint,
  deleteSprint,
} from "@/services/sprints";

/** GET /api/v1/sprints/[sprintId] — sprint detail + live metrics. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { sprintId } = await params;
  try {
    const sprint = await getSprint(ctx.workspaceId, sprintId);
    if (!sprint) return notFound("Sprint not found");
    return success(sprint);
  } catch (err) {
    console.error("GET sprint error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/sprints/[sprintId]
 *   - { action: "aktivieren" }   → start the sprint (single-active enforced)
 *   - { action: "abschliessen" } → close + carry over unfinished tasks
 *   - otherwise                  → edit name/goal/dates/capacity
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { sprintId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  try {
    if (body.action === "aktivieren") {
      const res = await activateSprint(ctx.workspaceId, sprintId);
      if (res.error) return badRequest(res.error);
      return success(res.sprint);
    }
    if (body.action === "abschliessen") {
      const res = await closeSprint(ctx.workspaceId, sprintId);
      if (res.error) return badRequest(res.error);
      return success({ sprint: res.sprint, summary: res.summary });
    }

    const sprint = await updateSprint(ctx.workspaceId, sprintId, {
      name: typeof body.name === "string" ? body.name : undefined,
      goal: body.goal === undefined ? undefined : (body.goal as string | null),
      startDate:
        body.startDate === undefined
          ? undefined
          : (body.startDate as string | null),
      endDate:
        body.endDate === undefined ? undefined : (body.endDate as string | null),
      capacityPoints:
        body.capacityPoints === undefined
          ? undefined
          : (body.capacityPoints as number | null),
    });
    if (!sprint) return notFound("Sprint not found");
    return success(sprint);
  } catch (err) {
    console.error("PATCH sprint error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update sprint" } },
      { status: 500 }
    );
  }
}

/** DELETE /api/v1/sprints/[sprintId] — only sprints still in Planung. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { sprintId } = await params;
  try {
    const res = await deleteSprint(ctx.workspaceId, sprintId);
    if (!res.ok) return badRequest(res.error ?? "Sprint konnte nicht geloescht werden.");
    return success({ deleted: true });
  } catch (err) {
    console.error("DELETE sprint error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete sprint" } },
      { status: 500 }
    );
  }
}
