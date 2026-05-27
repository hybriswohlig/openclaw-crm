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
import { and, eq, asc } from "drizzle-orm";
import { createTask } from "@/services/tasks";

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

    // Parent must belong to this workspace.
    const [parent] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!parent) return notFound("Task not found");

    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, taskId))
      .orderBy(asc(tasks.createdAt));

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
      pointEstimate?: number | null;
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
      pointEstimate:
        typeof body?.pointEstimate === "number" ? body.pointEstimate : null,
    });

    return success(sub, 201);
  } catch (err) {
    console.error("POST subtask error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create subtask" } },
      { status: 500 }
    );
  }
}
