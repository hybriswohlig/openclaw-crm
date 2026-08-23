import { NextRequest, NextResponse } from "next/server";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  notFound,
  success,
} from "@/lib/api-utils";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createTask, listSubtasks, describeTaskRouteError } from "@/services/tasks";

/**
 * GET /api/v1/tasks/[taskId]/subtasks — list children of a task.
 * Children are stored with parent_task_id = the task's id; not shown in
 * the top-level kanban so they don't clutter the board.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { taskId } = await params;

    // Enriched children (assignees, points, etc.) so subtasks render as
    // full mini-tasks. Returns null when the parent is not in this workspace.
    const rows = await listSubtasks(ctx.workspaceId, taskId);
    if (rows === null) return notFound("Task not found");

    return success(rows);
  } catch (err) {
    console.error("GET subtasks error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list subtasks" } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/tasks/[taskId]/subtasks — add a subtask under a parent.
 * Inherits the parent's deadline as a default if none is provided so
 * subtasks of an overdue parent show up under the right kanban column
 * without extra clicks.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { taskId } = await params;

    const body = (await req.json().catch(() => null)) as {
      content?: string;
      deadline?: string | null;
      assigneeIds?: string[];
    } | null;
    const content = body?.content?.trim();
    if (!content) return badRequest("content is required");

    // Parent must belong to this workspace.
    const [parent] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!parent) return notFound("Parent task not found");

    const sub = await createTask(content, ctx.userId, ctx.workspaceId, {
      parentTaskId: taskId,
      deadline:
        body?.deadline ??
        (parent.deadline ? parent.deadline.toISOString() : null),
      assigneeIds: body?.assigneeIds,
    });

    return success(sub, 201);
  } catch (err) {
    // I2: createTask throws TaskInvariantError for every invariant it
    // enforces (I4's parent-eligibility checks among them — e.g. re-
    // parenting under a task that is already a subtask), but this route
    // used to catch everything with one opaque English 500. That left an
    // MCP agent unable to tell "Unteraufgaben können keine weiteren
    // Unteraufgaben haben" from the CRM being down, so it retried in a
    // loop instead of correcting its call. Same pattern as the sibling
    // task routes (POST /api/v1/tasks, PATCH /api/v1/tasks/[taskId]) —
    // see describeTaskRouteError in services/tasks.ts.
    const message = describeTaskRouteError(err);
    if (message) return badRequest(message);
    console.error("POST subtask error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unteraufgabe konnte nicht erstellt werden." } },
      { status: 500 }
    );
  }
}
