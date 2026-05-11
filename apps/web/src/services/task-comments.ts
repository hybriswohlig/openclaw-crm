import { db } from "@/db";
import { taskComments, tasks, taskAssignees, users } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export interface TaskCommentRow {
  id: string;
  taskId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; email: string } | null;
}

/** List comments on a task, oldest first (timeline ordering). */
export async function listTaskComments(
  taskId: string,
  workspaceId: string
): Promise<TaskCommentRow[]> {
  // Workspace check first — make sure the task belongs to this workspace.
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) return [];

  const rows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      userId: taskComments.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.userId))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(taskComments.createdAt);

  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    body: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: r.userId
      ? {
          id: r.userId,
          name: r.userName ?? "",
          email: r.userEmail ?? "",
        }
      : null,
  }));
}

export async function createTaskComment(input: {
  taskId: string;
  workspaceId: string;
  userId: string;
  body: string;
}): Promise<TaskCommentRow | null> {
  const trimmed = input.body.trim();
  if (!trimmed) return null;

  // Verify task belongs to this workspace.
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.workspaceId, input.workspaceId)))
    .limit(1);
  if (!task) return null;

  const [inserted] = await db
    .insert(taskComments)
    .values({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      body: trimmed,
    })
    .returning();

  const [author] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  return {
    id: inserted.id,
    taskId: inserted.taskId,
    body: inserted.body,
    createdAt: inserted.createdAt,
    updatedAt: inserted.updatedAt,
    user: author
      ? { id: author.id, name: author.name ?? "", email: author.email ?? "" }
      : null,
  };
}

export async function deleteTaskComment(input: {
  commentId: string;
  workspaceId: string;
  /** Only the author may delete their own comment via this helper. */
  userId: string;
}): Promise<boolean> {
  const [row] = await db
    .delete(taskComments)
    .where(
      and(
        eq(taskComments.id, input.commentId),
        eq(taskComments.workspaceId, input.workspaceId),
        eq(taskComments.userId, input.userId)
      )
    )
    .returning({ id: taskComments.id });
  return !!row;
}

/**
 * Resolve who should be pinged on a new comment: every assignee + the task
 * creator, deduplicated, minus the comment author themselves.
 */
export async function commentAudience(input: {
  taskId: string;
  workspaceId: string;
  commentAuthorId: string;
}): Promise<string[]> {
  const [task] = await db
    .select({ createdBy: tasks.createdBy })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.workspaceId, input.workspaceId)))
    .limit(1);

  const assigneeRows = await db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, input.taskId));

  const set = new Set<string>();
  if (task?.createdBy) set.add(task.createdBy);
  for (const r of assigneeRows) set.add(r.userId);
  set.delete(input.commentAuthorId);
  return [...set];
}

// Re-export so callers can build queries without importing drizzle directly.
export { desc };
