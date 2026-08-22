import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateTask, deleteTask, describeTaskRouteError } from "@/services/tasks";
import { db } from "@/db";
import { taskAssignees } from "@/db/schema";
import { eq } from "drizzle-orm";

/** PATCH /api/v1/tasks/[taskId] */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { taskId } = await params;

  try {
    const body = await req.json() as {
      content?: string;
      deadline?: string | null;
      isCompleted?: boolean;
      recordIds?: string[];
      assigneeIds?: string[];
      sprintId?: string | null;
      description?: string | null;
      priority?: string | null;
      kind?: string | null;
      projectId?: string | null;
      phaseId?: string | null;
      area?: string | null;
      status?: string | null;
      startDate?: string | null;
      /** Spec §11: crm_update_task re-parents a task; I4 re-inherits. */
      parentTaskId?: string | null;
    };

    // Capture the previous assignee set BEFORE the update so we can tell
    // who is newly assigned (notify with "Neue Aufgabe …") vs who was
    // already on the task (notify with "aktualisiert").
    let priorAssigneeIds: string[] = [];
    if (body.assigneeIds !== undefined) {
      const rows = await db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId));
      priorAssigneeIds = rows.map((r) => r.userId);
    }

    const task = await updateTask(taskId, ctx.workspaceId, body, ctx.userId);
    if (!task) return notFound("Task not found");

    // Push notifications — split into "newly assigned" and "already on
    // the task" buckets so users get the right framing.
    const { waitUntil } = await import("@vercel/functions");
    const { notifyTaskAssigned, notifyTaskUpdated, describeTaskChange } =
      await import("@/services/task-notifications");

    const currentAssigneeIds = task.assignees.map((a) => a.id);
    const newlyAssigned =
      body.assigneeIds !== undefined
        ? currentAssigneeIds.filter((id) => !priorAssigneeIds.includes(id))
        : [];
    const wasAlreadyAssigned = currentAssigneeIds.filter(
      (id) => !newlyAssigned.includes(id)
    );

    if (newlyAssigned.length > 0) {
      waitUntil(
        notifyTaskAssigned({
          workspaceId: ctx.workspaceId,
          taskId: task.id,
          taskContent: task.content,
          actorUserId: ctx.userId,
          newAssigneeIds: newlyAssigned,
        })
      );
    }

    // Only fire an "updated" push when a content-bearing field changed —
    // otherwise reassign-only edits would double-notify the people who
    // stayed on the task.
    const fieldChanged =
      body.content !== undefined ||
      body.deadline !== undefined ||
      body.isCompleted !== undefined ||
      body.recordIds !== undefined;
    if (fieldChanged && wasAlreadyAssigned.length > 0) {
      waitUntil(
        notifyTaskUpdated({
          workspaceId: ctx.workspaceId,
          taskId: task.id,
          taskContent: task.content,
          actorUserId: ctx.userId,
          currentAssigneeIds: wasAlreadyAssigned,
          changeHint: describeTaskChange(body),
        })
      );
    }

    return success(task);
  } catch (err) {
    // updateTask throws plain Errors for every invariant it enforces (I2's
    // phase check, both halves of I4's parent/child-eligibility checks, the
    // self-parent guard) — route ALL of them to a 400 with their own
    // message, not just the ones this allowlist used to name. See
    // describeTaskRouteError in services/tasks.ts.
    return badRequest(describeTaskRouteError(err));
  }
}

/** DELETE /api/v1/tasks/[taskId] */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { taskId } = await params;

  try {
    const task = await deleteTask(taskId, ctx.workspaceId);
    if (!task) return notFound("Task not found");
    return success({ deleted: true });
  } catch (err) {
    console.error("Failed to delete task:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete task" } },
      { status: 500 }
    );
  }
}
