import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listTasks, createTask, describeTaskRouteError, type ListTaskOptions } from "@/services/tasks";
import { getActiveSprint } from "@/services/sprints";

/** GET /api/v1/tasks — All tasks for current user in active workspace */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { searchParams } = new URL(req.url);
    const showCompleted = searchParams.get("showCompleted") === "true";
    // `Number("abc")` is NaN, `Math.min(NaN, 200)` is NaN, and `.limit(NaN)`
    // is a Postgres syntax error — a 500 on a typo in the query string.
    const rawLimit = Number(searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawOffset = Number(searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    // Optional sprint scope:
    //   ?sprintId=<id>     → only that sprint
    //   ?sprintId=active   → only the currently active sprint (empty if none)
    //   ?sprintId=none     → only the product backlog (no sprint)
    const sprintParam = searchParams.get("sprintId");
    const listOpts: ListTaskOptions = { showCompleted, limit, offset };
    const completedAfterParam = searchParams.get("completedAfter");
    if (completedAfterParam) {
      const completedAfter = new Date(completedAfterParam);
      if (!Number.isNaN(completedAfter.getTime())) {
        listOpts.completedAfter = completedAfter;
      }
    }
    // New Projekte filters — every one of them is normalised in
    // planTaskFilters, so junk simply drops out instead of 400-ing.
    listOpts.kind = searchParams.get("kind");
    listOpts.projectId = searchParams.get("projectId");
    listOpts.phaseId = searchParams.get("phaseId");
    listOpts.area = searchParams.get("area");
    listOpts.status = searchParams.get("status");
    listOpts.overdue = searchParams.get("overdue") === "true";
    listOpts.includeSubtasks = searchParams.get("includeSubtasks") === "true";
    const dueWithinDaysParam = searchParams.get("dueWithinDays");
    if (dueWithinDaysParam !== null && dueWithinDaysParam !== "") {
      const parsedDays = Number(dueWithinDaysParam);
      if (Number.isFinite(parsedDays)) listOpts.dueWithinDays = parsedDays;
    }

    // UNCHANGED from today's route — the three sprint scopes stay:
    //   ?sprintId=<id>   → that sprint
    //   ?sprintId=active → the currently active sprint (empty when none)
    //   ?sprintId=none   → the product backlog
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
      sprintId: typeof body.sprintId === "string" ? body.sprintId : null,
      description: typeof body.description === "string" ? body.description : null,
      priority: typeof body.priority === "string" ? body.priority : null,
      kind: typeof body.kind === "string" ? body.kind : null,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      phaseId: typeof body.phaseId === "string" ? body.phaseId : null,
      area: typeof body.area === "string" ? body.area : null,
      status: typeof body.status === "string" ? body.status : null,
      startDate: typeof body.startDate === "string" ? body.startDate : null,
      // Spec §11: crm_create_task sends parentTaskId. createTask then
      // inherits kind/projectId/phaseId from that parent (I4).
      parentTaskId: typeof body.parentTaskId === "string" ? body.parentTaskId : null,
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
    // createTask throws plain Errors for every invariant it enforces (I2's
    // phase check, I4's parent-eligibility check) — route ALL of them to a
    // 400 with their own message, not just the one this allowlist used to
    // name. See describeTaskRouteError in services/tasks.ts.
    return badRequest(describeTaskRouteError(err));
  }
}
