import { db } from "@/db";
import {
  tasks,
  taskRecords,
  taskAssignees,
  users,
} from "@/db/schema";
import { eq, and, or, gte, desc, inArray, isNull, sql } from "drizzle-orm";
import { batchGetRecordDisplayNames } from "./display-names";
import { normalizeWorkType, normalizeGrowthCategory } from "@/lib/sprint-constants";
import { normalizePriority } from "@/lib/task-priority";
import {
  normalizeOperativeArea,
  normalizeTaskKind,
  normalizeTaskStatus,
  type OperativeArea,
  type TaskKind,
  type TaskStatus,
} from "@/lib/project-constants";

// ─── Invariants I1–I4, as pure decisions ─────────────────────────────
//
// Every write path in this file runs through these three helpers, which is
// what makes I1 (kind ⟺ project_id), I3 (status ⟺ is_completed) and the
// list filtering testable without a database.

export interface TaskPlacement {
  kind: TaskKind;
  projectId: string | null;
  phaseId: string | null;
}

/**
 * I1: `kind='projekt'` ⟺ `project_id IS NOT NULL`.
 * Setting a project promotes the task; clearing it (or sending
 * kind='operativ') demotes it and drops the phase. An explicit `projectId`
 * always wins over an explicit `kind`.
 */
export function resolveTaskKind(
  updates: { kind?: unknown; projectId?: unknown; phaseId?: unknown },
  current: TaskPlacement,
): TaskPlacement {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);

  let projectId = current.projectId;
  if (has("projectId")) {
    projectId = typeof updates.projectId === "string" && updates.projectId ? updates.projectId : null;
  } else if (has("kind") && normalizeTaskKind(updates.kind) === "operativ") {
    projectId = null;
  }

  if (!projectId) return { kind: "operativ", projectId: null, phaseId: null };

  let phaseId = projectId === current.projectId ? current.phaseId : null;
  if (has("phaseId")) {
    phaseId = typeof updates.phaseId === "string" && updates.phaseId ? updates.phaseId : null;
  }
  return { kind: "projekt", projectId, phaseId };
}

/**
 * I2: `phase_id IS NOT NULL` ⟹ the phase belongs to `project_id`.
 *
 * Pure decision only — the async wrapper in Task 12 does the SELECT and
 * passes `null` for `phaseProjectId` when the phase row does not exist or
 * lives in another workspace, which is also a violation.
 */
export function resolvePhaseAssignment(
  phaseProjectId: string | null,
  targetProjectId: string | null,
): { ok: true } | { ok: false; error: string } {
  if (phaseProjectId === null && targetProjectId === null) return { ok: true };
  if (phaseProjectId !== null && phaseProjectId === targetProjectId) return { ok: true };
  return { ok: false, error: "Phase gehört nicht zu diesem Projekt" };
}

/**
 * I4 cap: a task that is already a subtask (has a parentTaskId) cannot itself
 * become a parent. The cascade in updateTask is `WHERE parent_task_id = <id>`,
 * one level deep — it reaches children but not grandchildren, so allowing a
 * subtask to acquire children would silently leave grandchildren stranded
 * with a stale kind/project/phase whenever the middle task moves.
 */
export function resolveParentEligibility(
  parent: { parentTaskId: string | null } | null,
): { ok: true } | { ok: false; error: string } {
  if (!parent) return { ok: true };
  if (parent.parentTaskId) {
    return { ok: false, error: "Unteraufgaben können keine weiteren Unteraufgaben haben" };
  }
  return { ok: true };
}

/**
 * I4: a subtask inherits `kind`, `project_id` and `phase_id` from its parent,
 * on create AND whenever it is re-parented. Also repairs a parent row whose
 * `kind` column drifted from its `project_id` (I1).
 */
export function resolveInheritedPlacement(
  parent: { kind: string | null; projectId: string | null; phaseId: string | null } | null,
  fallback: TaskPlacement,
): TaskPlacement {
  if (!parent) return fallback;
  if (!parent.projectId) return { kind: "operativ", projectId: null, phaseId: null };
  return {
    kind: "projekt",
    projectId: parent.projectId,
    phaseId: parent.phaseId ?? null,
  };
}

export interface TaskCompletion {
  status: TaskStatus;
  isCompleted: boolean;
  completedAt: Date | null;
}

/**
 * I3: `status='erledigt'` ⟺ `is_completed = true`. `status` is the leading
 * field, `is_completed` the compatibility mirror the other 35 files read.
 */
export function resolveTaskStatus(
  updates: { status?: unknown; isCompleted?: unknown },
  current: TaskCompletion,
  now: Date = new Date(),
): TaskCompletion {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);

  let status = current.status;
  if (has("status")) {
    status = normalizeTaskStatus(updates.status) ?? current.status;
  } else if (has("isCompleted") && typeof updates.isCompleted === "boolean") {
    if (updates.isCompleted) status = "erledigt";
    else if (current.status === "erledigt") status = "geplant";
  }

  const isCompleted = status === "erledigt";
  const completedAt = isCompleted
    ? current.isCompleted && current.completedAt
      ? current.completedAt
      : now
    : null;
  return { status, isCompleted, completedAt };
}

export interface ListTaskOptions {
  showCompleted?: boolean;
  limit?: number;
  offset?: number;
  /** Only tasks in this sprint. */
  sprintId?: string;
  /** Only tasks NOT in any sprint (product backlog). */
  noSprint?: boolean;
  /** With showCompleted: only completed tasks finished at/after this date. */
  completedAfter?: Date;
  kind?: string | null;
  projectId?: string | null;
  phaseId?: string | null;
  area?: string | null;
  status?: string | null;
  /** deadline < today 00:00 and not erledigt. */
  overdue?: boolean;
  /** deadline <= end of (today + n days). 0 means "heute fällig". */
  dueWithinDays?: number;
  /** Default false — preserves today's parentTaskId IS NULL filter. */
  includeSubtasks?: boolean;
}

export interface TaskFilterPlan {
  showCompleted: boolean;
  completedAfter: Date | null;
  topLevelOnly: boolean;
  sprintId: string | null;
  noSprint: boolean;
  kind: TaskKind | null;
  projectId: string | null;
  phaseId: string | null;
  area: OperativeArea | null;
  status: TaskStatus | null;
  overdue: boolean;
  /**
   * These three are compared against `tasks.deadline`, which is a TIMESTAMP
   * column — so a JS Date is the correct binding here. Do not turn them into
   * "YYYY-MM-DD" strings; that rule applies to the `date` columns
   * (`tasks.start_date`, phase/milestone/budget dates) only.
   */
  todayStart: Date;
  /**
   * Lower bound, always set together with dueBefore. Without it,
   * `deadline <= today 23:59` also matches everything already overdue and
   * the dashboard tile „n heute fällig" would be a lie.
   */
  dueFrom: Date | null;
  dueBefore: Date | null;
  limit: number;
  offset: number;
}

/** Pure: request options → the resolved filter decisions listTasks applies. */
export function planTaskFilters(
  options: ListTaskOptions,
  now: Date = new Date(),
): TaskFilterPlan {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // A due-window is ALWAYS bounded on both sides: [today 00:00, day n 23:59].
  let dueFrom: Date | null = null;
  let dueBefore: Date | null = null;
  if (typeof options.dueWithinDays === "number" && Number.isFinite(options.dueWithinDays)) {
    dueFrom = new Date(todayStart);
    dueBefore = new Date(todayStart);
    dueBefore.setDate(dueBefore.getDate() + Math.max(0, Math.round(options.dueWithinDays)));
    dueBefore.setHours(23, 59, 59, 999);
  }

  const sprintId = options.sprintId ? options.sprintId : null;

  return {
    showCompleted: options.showCompleted === true,
    completedAfter: options.completedAfter ?? null,
    topLevelOnly: options.includeSubtasks !== true,
    sprintId,
    noSprint: sprintId ? false : options.noSprint === true,
    kind: normalizeTaskKind(options.kind),
    projectId: options.projectId ? options.projectId : null,
    phaseId: options.phaseId ? options.phaseId : null,
    area: normalizeOperativeArea(options.area),
    status: normalizeTaskStatus(options.status),
    overdue: options.overdue === true,
    todayStart,
    dueFrom,
    dueBefore,
    limit: Math.min(Math.max(options.limit ?? 50, 1), 200),
    offset: Math.max(options.offset ?? 0, 0),
  };
}

/** Allowed Fibonacci sizes — anything else is coerced to null. */
export const TASK_POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;
export type TaskPointEstimate = (typeof TASK_POINT_VALUES)[number];

export function normalizePoints(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return (TASK_POINT_VALUES as readonly number[]).includes(v) ? v : null;
}

export interface TaskData {
  id: string;
  content: string;
  deadline: Date | null;
  isCompleted: boolean;
  completedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  linkedRecords: { id: string; displayName: string; objectSlug: string }[];
  assignees: { id: string; name: string; email: string }[];
  kanbanStatus: string | null;
  /** Fibonacci size (1,2,3,5,8,13) or null when not estimated. */
  pointEstimate: number | null;
  /** Sprint membership; null = product backlog / pure flow. */
  sprintId: string | null;
  /** 'flow' | 'build' | null (null reads as flow). */
  workType: string | null;
  /** Growth-category slug for build tasks, or null. */
  growthCategory: string | null;
  /** Free-text details beyond the title, or null. */
  description: string | null;
  /** 'niedrig' | 'mittel' | 'hoch' | null. */
  priority: string | null;
  /** Parent task id for subtasks, else null. */
  parentTaskId: string | null;
}

/** Batch-enrich an array of task rows into TaskData[] (~3 queries total) */
async function enrichTasks(
  taskRows: (typeof tasks.$inferSelect)[]
): Promise<TaskData[]> {
  if (taskRows.length === 0) return [];

  const taskIds = taskRows.map((t) => t.id);

  // 1. Batch get all task_records + task_assignees in parallel
  const [allTaskRecords, allTaskAssignees] = await Promise.all([
    db
      .select({ taskId: taskRecords.taskId, recordId: taskRecords.recordId })
      .from(taskRecords)
      .where(inArray(taskRecords.taskId, taskIds)),
    db
      .select({
        taskId: taskAssignees.taskId,
        userId: taskAssignees.userId,
        name: users.name,
        email: users.email,
      })
      .from(taskAssignees)
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .where(inArray(taskAssignees.taskId, taskIds)),
  ]);

  // 2. Collect unique recordIds and batch-resolve display names
  const allRecordIds = [...new Set(allTaskRecords.map((tr) => tr.recordId))];
  const displayMap = await batchGetRecordDisplayNames(allRecordIds);

  // 3. Group by taskId
  const recordsByTask = new Map<string, { id: string; displayName: string; objectSlug: string }[]>();
  for (const tr of allTaskRecords) {
    const info = displayMap.get(tr.recordId);
    const arr = recordsByTask.get(tr.taskId) || [];
    arr.push({
      id: tr.recordId,
      displayName: info?.displayName || "Unknown",
      objectSlug: info?.objectSlug || "",
    });
    recordsByTask.set(tr.taskId, arr);
  }

  const assigneesByTask = new Map<string, { id: string; name: string; email: string }[]>();
  for (const ta of allTaskAssignees) {
    const arr = assigneesByTask.get(ta.taskId) || [];
    arr.push({ id: ta.userId, name: ta.name, email: ta.email });
    assigneesByTask.set(ta.taskId, arr);
  }

  return taskRows.map((t) => ({
    id: t.id,
    content: t.content,
    deadline: t.deadline,
    isCompleted: t.isCompleted,
    completedAt: t.completedAt,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    linkedRecords: recordsByTask.get(t.id) || [],
    assignees: assigneesByTask.get(t.id) || [],
    kanbanStatus: t.kanbanStatus ?? null,
    pointEstimate: t.pointEstimate ?? null,
    sprintId: t.sprintId ?? null,
    workType: t.workType ?? null,
    growthCategory: t.growthCategory ?? null,
    description: t.description ?? null,
    priority: t.priority ?? null,
    parentTaskId: t.parentTaskId ?? null,
  }));
}

// ─── CRUD ────────────────────────────────────────────────────────────

export async function listTasks(
  workspaceId: string,
  _createdBy: string,
  options: {
    showCompleted?: boolean;
    limit?: number;
    offset?: number;
    /** Only tasks in this sprint. */
    sprintId?: string;
    /** Only tasks NOT in any sprint (product backlog / flow). */
    noSprint?: boolean;
    /** With showCompleted: only completed tasks finished at/after this date. */
    completedAfter?: Date;
  } = {}
) {
  const { showCompleted = false, limit = 50, offset = 0 } = options;

  // Subtasks are excluded from the top-level kanban — they show up
  // inside their parent's TaskDialog instead. parentTaskId IS NULL means
  // "this is a top-level task".
  const clauses = [eq(tasks.workspaceId, workspaceId), sql`${tasks.parentTaskId} IS NULL`];
  if (!showCompleted) {
    clauses.push(eq(tasks.isCompleted, false));
  } else if (options.completedAfter) {
    clauses.push(
      or(
        eq(tasks.isCompleted, false),
        gte(tasks.completedAt, options.completedAfter)
      )!
    );
  }
  if (options.sprintId) clauses.push(eq(tasks.sprintId, options.sprintId));
  else if (options.noSprint) clauses.push(isNull(tasks.sprintId));
  const whereClause = and(...clauses);

  const [taskRows, [countResult]] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(whereClause)
      .orderBy(tasks.deadline, desc(tasks.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(whereClause),
  ]);

  return { tasks: await enrichTasks(taskRows), total: Number(countResult.count) };
}

export async function getTasksForRecord(recordId: string) {
  const trRows = await db
    .select({ taskId: taskRecords.taskId })
    .from(taskRecords)
    .where(eq(taskRecords.recordId, recordId));

  if (trRows.length === 0) return [];

  const taskIds = trRows.map((r) => r.taskId);
  const taskRows = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.id, taskIds))
    .orderBy(tasks.deadline, desc(tasks.createdAt));

  return enrichTasks(taskRows);
}

/**
 * Enriched children of a task (assignees, points, sprint, etc.) so subtasks
 * can be rendered as full mini-tasks. Verifies the parent is in-workspace.
 */
export async function listSubtasks(workspaceId: string, parentTaskId: string) {
  const [parent] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parentTaskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!parent) return null;

  const childRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(tasks.createdAt);

  return enrichTasks(childRows);
}

export async function createTask(
  content: string,
  createdBy: string,
  workspaceId: string,
  options: {
    deadline?: string | null;
    recordIds?: string[];
    assigneeIds?: string[];
    parentTaskId?: string | null;
    recurrenceRule?: "daily" | "weekly" | "monthly" | null;
    pointEstimate?: number | null;
    sprintId?: string | null;
    workType?: string | null;
    growthCategory?: string | null;
    description?: string | null;
    priority?: string | null;
  } = {}
) {
  const [task] = await db
    .insert(tasks)
    .values({
      content,
      createdBy,
      workspaceId,
      deadline: options.deadline ? new Date(options.deadline) : null,
      parentTaskId: options.parentTaskId ?? null,
      recurrenceRule: options.recurrenceRule ?? null,
      recurrenceAnchor: options.recurrenceRule
        ? options.deadline
          ? new Date(options.deadline)
          : new Date()
        : null,
      pointEstimate: normalizePoints(options.pointEstimate),
      sprintId: options.sprintId ?? null,
      workType: normalizeWorkType(options.workType),
      growthCategory: normalizeGrowthCategory(options.growthCategory),
      description: options.description?.trim() ? options.description.trim() : null,
      priority: normalizePriority(options.priority),
    })
    .returning();

  // Link records
  if (options.recordIds && options.recordIds.length > 0) {
    await db.insert(taskRecords).values(
      options.recordIds.map((recordId) => ({
        taskId: task.id,
        recordId,
      }))
    );
  }

  // Add assignees
  if (options.assigneeIds && options.assigneeIds.length > 0) {
    await db.insert(taskAssignees).values(
      options.assigneeIds.map((userId) => ({
        taskId: task.id,
        userId,
      }))
    );
  }

  return (await enrichTasks([task]))[0];
}

export async function updateTask(
  taskId: string,
  workspaceId: string,
  updates: {
    content?: string;
    deadline?: string | null;
    isCompleted?: boolean;
    recordIds?: string[];
    assigneeIds?: string[];
    recurrenceRule?: "daily" | "weekly" | "monthly" | null;
    kanbanStatus?: "backlog" | "heute" | "laeuft" | "warte" | "erledigt" | null;
    pointEstimate?: number | null;
    sprintId?: string | null;
    workType?: string | null;
    growthCategory?: string | null;
    description?: string | null;
    priority?: string | null;
  }
) {
  // Verify task belongs to workspace
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);

  if (!existing) return null;

  const setValues: Record<string, unknown> = {};
  if (updates.content !== undefined) setValues.content = updates.content;
  if (updates.deadline !== undefined) {
    setValues.deadline = updates.deadline ? new Date(updates.deadline) : null;
    // Reset the overdue-notified flag so a re-scheduled task can be
    // re-flagged once the new deadline passes.
    setValues.overdueNotifiedAt = null;
  }
  if (updates.isCompleted !== undefined) {
    setValues.isCompleted = updates.isCompleted;
    setValues.completedAt = updates.isCompleted ? new Date() : null;
  }
  if (updates.recurrenceRule !== undefined) {
    setValues.recurrenceRule = updates.recurrenceRule;
  }
  if (updates.kanbanStatus !== undefined) {
    setValues.kanbanStatus = updates.kanbanStatus;
  }
  if (updates.pointEstimate !== undefined) {
    setValues.pointEstimate = normalizePoints(updates.pointEstimate);
  }
  if (updates.sprintId !== undefined) {
    // Empty string from the form means "Kein Sprint".
    setValues.sprintId = updates.sprintId ? updates.sprintId : null;
  }
  if (updates.workType !== undefined) {
    setValues.workType = normalizeWorkType(updates.workType);
  }
  if (updates.growthCategory !== undefined) {
    setValues.growthCategory = normalizeGrowthCategory(updates.growthCategory);
  }
  if (updates.description !== undefined) {
    setValues.description = updates.description?.trim()
      ? updates.description.trim()
      : null;
  }
  if (updates.priority !== undefined) {
    setValues.priority = normalizePriority(updates.priority);
  }

  if (Object.keys(setValues).length > 0) {
    const [updated] = await db
      .update(tasks)
      .set(setValues)
      .where(eq(tasks.id, taskId))
      .returning();
    if (!updated) return null;
  }

  // Replace linked records
  if (updates.recordIds !== undefined) {
    await db.delete(taskRecords).where(eq(taskRecords.taskId, taskId));
    if (updates.recordIds.length > 0) {
      await db.insert(taskRecords).values(
        updates.recordIds.map((recordId) => ({ taskId, recordId }))
      );
    }
  }

  // Replace assignees
  if (updates.assigneeIds !== undefined) {
    await db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
    if (updates.assigneeIds.length > 0) {
      await db.insert(taskAssignees).values(
        updates.assigneeIds.map((userId) => ({ taskId, userId }))
      );
    }
  }

  // Re-fetch the task to return enriched data
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return null;
  return (await enrichTasks([task]))[0];
}

export async function deleteTask(taskId: string, workspaceId: string) {
  const [task] = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .returning();
  return task;
}

/** Get tasks that are due soon (for home page widget) */
export async function getUpcomingTasks(workspaceId: string, _createdBy: string, limit = 10) {
  const taskRows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.isCompleted, false)
      )
    )
    .orderBy(tasks.deadline, desc(tasks.createdAt))
    .limit(limit);

  return enrichTasks(taskRows);
}
