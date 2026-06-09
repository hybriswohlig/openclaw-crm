import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listTasks, createTask } from "@/services/tasks";
import { getActiveSprint } from "@/services/sprints";

/** GET /api/v1/tasks — All tasks for current user in active workspace */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { searchParams } = new URL(req.url);
    const showCompleted = searchParams.get("showCompleted") === "true";
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
    const offset = Number(searchParams.get("offset") || 0);

    // Optional sprint scope:
    //   ?sprintId=<id>     → only that sprint
    //   ?sprintId=active   → only the currently active sprint (empty if none)
    //   ?sprintId=none     → only the product backlog (no sprint)
    const sprintParam = searchParams.get("sprintId");
    const listOpts: {
      showCompleted: boolean;
      limit: number;
      offset: number;
      sprintId?: string;
      noSprint?: boolean;
    } = { showCompleted, limit, offset };
    if (sprintParam === "none") {
      listOpts.noSprint = true;
    } else if (sprintParam === "active") {
      const active = await getActiveSprint(ctx.workspaceId);
      if (!active) {
        return success({ tasks: [], pagination: { limit, offset, total: 0 } });
      }
      listOpts.sprintId = active.id;
    } else if (sprintParam) {
      listOpts.sprintId = sprintParam;
    }

    const result = await listTasks(ctx.workspaceId, ctx.userId, listOpts);

    return success({
      tasks: result.tasks,
      pagination: { limit, offset, total: result.total },
    });
  } catch (err) {
    console.error("GET /api/v1/tasks error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 }
    );
  }
}

/** POST /api/v1/tasks — Create task */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!body.content) return badRequest("content is required");

  try {
    const assigneeIds = body.assigneeIds as string[] | undefined;
    const task = await createTask(body.content as string, ctx.userId, ctx.workspaceId, {
      deadline: body.deadline as string | undefined,
      recordIds: body.recordIds as string[] | undefined,
      assigneeIds,
      pointEstimate:
        typeof body.pointEstimate === "number" ? body.pointEstimate : null,
      sprintId: typeof body.sprintId === "string" ? body.sprintId : null,
      workType: typeof body.workType === "string" ? body.workType : null,
      growthCategory:
        typeof body.growthCategory === "string" ? body.growthCategory : null,
      description:
        typeof body.description === "string" ? body.description : null,
      priority: typeof body.priority === "string" ? body.priority : null,
    });

    // Push-notify each new assignee (excluding the creator themselves).
    // waitUntil keeps the Vercel function alive until the push request
    // finishes, without delaying the HTTP response.
    if (task && assigneeIds && assigneeIds.length > 0) {
      const { waitUntil } = await import("@vercel/functions");
      const { notifyTaskAssigned } = await import("@/services/task-notifications");
      waitUntil(
        notifyTaskAssigned({
          workspaceId: ctx.workspaceId,
          taskId: task.id,
          taskContent: task.content,
          actorUserId: ctx.userId,
          newAssigneeIds: assigneeIds,
        })
      );
    }

    return success(task, 201);
  } catch (err) {
    console.error("Failed to create task:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create task" } },
      { status: 500 }
    );
  }
}
