import { db } from "@/db";
import {
  tasks,
  taskRecords,
  taskAssignees,
  taskDependencies,
  users,
  projects,
  projectPhases,
} from "@/db/schema";
import { eq, and, or, asc, gte, lte, lt, desc, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { batchGetRecordDisplayNames } from "./display-names";
import { normalizePriority, type Priority } from "@/lib/task-priority";
import { parseDateColumn } from "@/lib/work-metrics";
import {
  normalizeOperativeArea,
  normalizeTaskKind,
  normalizeTaskStatus,
  type OperativeArea,
  type TaskKind,
  type TaskStatus,
} from "@/lib/project-constants";
import { emitEvent } from "./activity-events";

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

// F2: routes need to tell "the caller sent something that violates an
// invariant" (→ 400, safe to show the German message) apart from "something
// unexpected blew up" (→ 500, log it, show a fixed message — never a raw
// driver/Postgres string). Every invariant guard below throws THIS class;
// a bare `Error`/`TypeError`/driver exception is anything else.
export class TaskInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskInvariantError";
  }
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
 * Pure decision only — the async wrapper below does the SELECT and passes
 * `null` for `phaseProjectId` when the phase row does not exist or lives in
 * another workspace, which is also a violation.
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
 * F1: `tasks.parent_task_id` has no FK, so an unresolved `parentTaskId`
 * used to insert a row silently — hidden forever by the `parentTaskId IS
 * NULL` list filter, unreachable via the parent's subtasks route (parent
 * 404s), yet still counted by getWorkCounts. This is createTask's half of
 * the check updateTask already makes on re-parent (`if (!row) throw
 * "Übergeordnete Aufgabe nicht gefunden"`). Pure: given the id the caller
 * asked for and what the lookup found (or didn't), decide whether to fail.
 */
export function resolveParentFound(
  requestedParentTaskId: string | null | undefined,
  parent: unknown,
): { ok: true } | { ok: false; error: string } {
  if (requestedParentTaskId && !parent) {
    return { ok: false, error: "Übergeordnete Aufgabe nicht gefunden" };
  }
  return { ok: true };
}

/**
 * I4 cap, the other half of resolveParentEligibility: a task that already
 * HAS children cannot itself become a child. The cascade in updateTask is
 * `WHERE parent_task_id = <id>`, one level deep — allowing this would leave
 * the existing children stranded as grandchildren the cascade cannot reach
 * whenever this task moves. Together with resolveParentEligibility (which
 * blocks a subtask from becoming a parent), this is what makes a three-level
 * task chain structurally impossible.
 */
export function resolveChildEligibility(
  hasExistingChildren: boolean,
): { ok: true } | { ok: false; error: string } {
  if (hasExistingChildren) {
    return { ok: false, error: "Aufgaben mit Unteraufgaben können nicht verschachtelt werden" };
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

export interface TaskActivityEmission {
  eventType: "task.moved_to_project" | "task.status_changed";
  /** activity_events.record_id — nullable, but only in theory here (see below). */
  recordId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Pure: which activity events (if any) a committed updateTask call should
 * emit, and with what payload. The async wrapper just calls emitEvent once
 * per entry this returns — nothing here decides whether the row hits the DB.
 *
 * Two independent gates, spec §10.1:
 *   - task.moved_to_project fires exactly when placement (kind/project/phase)
 *     changed — a content-only or status-only edit must NOT emit it.
 *   - task.status_changed fires exactly when completion changed AND the
 *     task's (new) placement has a project. activity_events.record_id is
 *     nullable, so an operative task would not throw here — it would file a
 *     row nothing can ever read (the project tab queries by projectId, the
 *     dashboard feed filters by type), quietly accumulating unreadable rows
 *     every time an operative checkbox is ticked.
 */
export function planTaskActivityEmissions(input: {
  taskId: string;
  placementChanged: boolean;
  completionChanged: boolean;
  currentPlacement: TaskPlacement;
  placement: TaskPlacement;
  currentCompletion: TaskCompletion;
  completion: TaskCompletion;
}): TaskActivityEmission[] {
  const emissions: TaskActivityEmission[] = [];
  if (input.placementChanged) {
    emissions.push({
      eventType: "task.moved_to_project",
      recordId: input.placement.projectId ?? input.currentPlacement.projectId,
      payload: {
        taskId: input.taskId,
        fromProjectId: input.currentPlacement.projectId,
        toProjectId: input.placement.projectId,
        fromPhaseId: input.currentPlacement.phaseId,
        toPhaseId: input.placement.phaseId,
      },
    });
  }
  if (input.completionChanged && input.placement.projectId) {
    emissions.push({
      eventType: "task.status_changed",
      recordId: input.placement.projectId,
      payload: {
        taskId: input.taskId,
        from: input.currentCompletion.status,
        to: input.completion.status,
      },
    });
  }
  return emissions;
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

export type KindFilterClause =
  | { column: "projectId"; op: "isNotNull" }
  | { column: "projectId"; op: "isNull" }
  | null;

/**
 * NULL-TOLERANCE (see the longer comment beside its call site in listTasks):
 * `kind` and `status` are nullable columns, and enrichTasks defaults a NULL
 * to a real value. `eq(tasks.kind, "operativ")` evaluates to NULL — i.e.
 * "not matched" — for any pre-migration row whose `kind` column is NULL, so
 * that row would render as operativ but be invisible to this filter. I1 says
 * kind ⟺ project_id, so this discriminates on the NOT-NULL-safe `projectId`
 * column instead, never on `kind` itself.
 */
export function planKindFilterClause(kind: TaskKind | null): KindFilterClause {
  if (kind === "projekt") return { column: "projectId", op: "isNotNull" };
  if (kind === "operativ") return { column: "projectId", op: "isNull" };
  return null;
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
  sprintId: string | null;
  description: string | null;
  priority: Priority | null;
  parentTaskId: string | null;
  /** 'projekt' when the task belongs to a project, else 'operativ' (I1). */
  kind: TaskKind;
  projectId: string | null;
  /** Denormalised for list rendering — never written back. */
  projectName: string | null;
  phaseId: string | null;
  /** Operative area tag; only meaningful for kind='operativ'. */
  area: OperativeArea | null;
  /** Leading status field; is_completed mirrors it (I3). */
  status: TaskStatus;
  /** Bar start in the sprint timeline. */
  startDate: Date | null;
}

/** Batch-enrich task rows into TaskData[] (~4 queries total). */
async function enrichTasks(
  taskRows: (typeof tasks.$inferSelect)[],
): Promise<TaskData[]> {
  if (taskRows.length === 0) return [];

  const taskIds = taskRows.map((t) => t.id);
  const projectIds = [
    ...new Set(taskRows.map((t) => t.projectId).filter((v): v is string => !!v)),
  ];

  const [allTaskRecords, allTaskAssignees, projectRows] = await Promise.all([
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
    projectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const allRecordIds = [...new Set(allTaskRecords.map((tr) => tr.recordId))];
  const displayMap = await batchGetRecordDisplayNames(allRecordIds);

  const recordsByTask = new Map<
    string,
    { id: string; displayName: string; objectSlug: string }[]
  >();
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

  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));

  return taskRows.map((t) => ({
    id: t.id,
    content: t.content,
    // deadline / completedAt / createdAt are TIMESTAMP columns and already
    // arrive as Date — only `start_date` below is a string-mode `date`.
    deadline: t.deadline,
    isCompleted: t.isCompleted,
    completedAt: t.completedAt,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    linkedRecords: recordsByTask.get(t.id) || [],
    assignees: assigneesByTask.get(t.id) || [],
    sprintId: t.sprintId ?? null,
    description: t.description ?? null,
    priority: normalizePriority(t.priority),
    parentTaskId: t.parentTaskId ?? null,
    kind: normalizeTaskKind(t.kind) ?? (t.projectId ? "projekt" : "operativ"),
    projectId: t.projectId ?? null,
    projectName: t.projectId ? projectNameById.get(t.projectId) ?? null : null,
    phaseId: t.phaseId ?? null,
    area: normalizeOperativeArea(t.area),
    status: normalizeTaskStatus(t.status) ?? (t.isCompleted ? "erledigt" : "geplant"),
    startDate: parseDateColumn(t.startDate),
  }));
}

/**
 * I2 wrapper: look the phase up, then let the PURE `resolvePhaseAssignment`
 * decide. A missing row (unknown id / other workspace) is passed as null,
 * which the helper treats as a violation.
 */
async function assertPhaseBelongsToProject(
  workspaceId: string,
  placement: TaskPlacement,
): Promise<void> {
  if (!placement.phaseId) return;
  const [row] = await db
    .select({ projectId: projectPhases.projectId })
    .from(projectPhases)
    .where(
      and(
        eq(projectPhases.id, placement.phaseId),
        eq(projectPhases.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const check = resolvePhaseAssignment(row?.projectId ?? null, placement.projectId);
  if (!check.ok) throw new TaskInvariantError(check.error);
}

// ─── CRUD ────────────────────────────────────────────────────────────

export async function listTasks(
  workspaceId: string,
  _createdBy: string,
  options: ListTaskOptions = {},
) {
  const plan = planTaskFilters(options);

  const clauses = [eq(tasks.workspaceId, workspaceId)];
  // Subtasks stay out of the top-level lists unless explicitly asked for —
  // the project task list and the progress counters need every row.
  if (plan.topLevelOnly) clauses.push(isNull(tasks.parentTaskId));
  if (!plan.showCompleted) {
    clauses.push(eq(tasks.isCompleted, false));
  } else if (plan.completedAfter) {
    clauses.push(
      or(eq(tasks.isCompleted, false), gte(tasks.completedAt, plan.completedAfter))!,
    );
  }
  if (plan.sprintId) clauses.push(eq(tasks.sprintId, plan.sprintId));
  else if (plan.noSprint) clauses.push(isNull(tasks.sprintId));
  // NULL-TOLERANCE — see planKindFilterClause. A row with NULL `kind` would
  // RENDER as operativ (enrichTasks defaults it) but be invisible to a filter
  // that names the `kind` column directly — `/tasks/operative` would omit it
  // while `GET /api/v1/tasks/<id>` returned it. `ne(NULL, 'erledigt')` is
  // NULL, i.e. "not matched", which is the same trap in the other direction.
  const kindClause = planKindFilterClause(plan.kind);
  if (kindClause) {
    clauses.push(
      kindClause.op === "isNotNull" ? isNotNull(tasks.projectId) : isNull(tasks.projectId),
    );
  }

  if (plan.projectId) clauses.push(eq(tasks.projectId, plan.projectId));
  if (plan.phaseId) clauses.push(eq(tasks.phaseId, plan.phaseId));
  // `area` has no default in the read path (NULL stays null), so a plain
  // equality is already consistent here.
  if (plan.area) clauses.push(eq(tasks.area, plan.area));

  if (plan.status === "erledigt") {
    clauses.push(
      or(eq(tasks.status, "erledigt"), and(isNull(tasks.status), eq(tasks.isCompleted, true)))!,
    );
  } else if (plan.status === "geplant") {
    clauses.push(
      or(eq(tasks.status, "geplant"), and(isNull(tasks.status), eq(tasks.isCompleted, false)))!,
    );
  } else if (plan.status) {
    // 'in_arbeit' is never the default of a NULL row.
    clauses.push(eq(tasks.status, plan.status));
  }

  if (plan.overdue) {
    clauses.push(lt(tasks.deadline, plan.todayStart));
    // ONE source of truth for doneness in this builder: is_completed. It is
    // NOT NULL with a default, I3 keeps it in sync with `status`, and
    // `showCompleted` above already uses it — mixing the two columns is how
    // the Überfällig tile and the Überfällig list disagreed.
    clauses.push(eq(tasks.isCompleted, false));
  }
  // Both bounds together: "heute fällig" must not sweep in the overdue.
  if (plan.dueFrom) clauses.push(gte(tasks.deadline, plan.dueFrom));
  if (plan.dueBefore) clauses.push(lte(tasks.deadline, plan.dueBefore));
  const whereClause = and(...clauses);

  const [taskRows, [countResult]] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(whereClause)
      // `deadline ASC` is NULLS LAST in Postgres, so undated tasks are always
      // last and are the first thing the cap truncates — written down in the
      // route doc because the UI builds counters on top of it. `id` is the
      // tiebreaker: createProject inserts every wizard task in ONE
      // transaction and Postgres `now()` is fixed for a transaction, so a
      // dozen rows share created_at to the microsecond and a paged sort on a
      // degenerate key can show a row twice or never.
      .orderBy(tasks.deadline, desc(tasks.createdAt), asc(tasks.id))
      .limit(plan.limit)
      .offset(plan.offset),
    db.select({ count: sql<number>`count(*)` }).from(tasks).where(whereClause),
  ]);

  return { tasks: await enrichTasks(taskRows), total: Number(countResult.count) };
}

/**
 * C1: a single enriched task by id, workspace-scoped. This is what backs
 * `GET /api/v1/tasks/[taskId]` and `crm_get_task` — without it an agent has
 * no way to read the current assigneeIds/recordIds before a PATCH, even
 * though crm_update_task's own description tells it to (both REPLACE the
 * whole set on write).
 */
export async function getTask(taskId: string, workspaceId: string): Promise<TaskData | null> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) return null;
  return (await enrichTasks([task]))[0];
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
    sprintId?: string | null;
    description?: string | null;
    priority?: string | null;
    kind?: string | null;
    projectId?: string | null;
    phaseId?: string | null;
    area?: string | null;
    status?: string | null;
    startDate?: string | null;
  } = {},
) {
  const requested: { kind?: unknown; projectId?: unknown; phaseId?: unknown } = {};
  if (options.kind !== undefined) requested.kind = options.kind;
  if (options.projectId !== undefined) requested.projectId = options.projectId;
  if (options.phaseId !== undefined) requested.phaseId = options.phaseId;

  let placement = resolveTaskKind(requested, {
    kind: "operativ",
    projectId: null,
    phaseId: null,
  });

  // I4: a subtask always inherits the parent's kind / project / phase, and
  // the hierarchy is capped at two levels — the cascade in updateTask is
  // `WHERE parent_task_id = <id>` and would not reach a grandchild.
  if (options.parentTaskId) {
    const [parent] = await db
      .select({
        kind: tasks.kind,
        projectId: tasks.projectId,
        phaseId: tasks.phaseId,
        parentTaskId: tasks.parentTaskId,
      })
      .from(tasks)
      .where(and(eq(tasks.id, options.parentTaskId), eq(tasks.workspaceId, workspaceId)))
      .limit(1);
    // F1: a dangling parentTaskId has no FK to catch it, and would insert a
    // task the parentTaskId-IS-NULL list filter hides forever.
    const found = resolveParentFound(options.parentTaskId, parent);
    if (!found.ok) throw new TaskInvariantError(found.error);
    const eligible = resolveParentEligibility(parent ?? null);
    if (!eligible.ok) throw new TaskInvariantError(eligible.error);
    placement = resolveInheritedPlacement(parent ?? null, placement);
  }
  await assertPhaseBelongsToProject(workspaceId, placement);

  const completion = resolveTaskStatus(
    options.status !== undefined ? { status: options.status } : {},
    { status: "geplant", isCompleted: false, completedAt: null },
  );

  // ONE transaction for task + record links + assignees. Unwrapped, a failed
  // assignee insert (a user deleted since the picker loaded, an FK violation)
  // left the task created and the links half-written, and the route 500'd.
  const task = await db.transaction(async (tx) => {
  const [inserted] = await tx
    .insert(tasks)
    .values({
      content,
      createdBy,
      workspaceId,
      // deadline is a TIMESTAMP → Date; start_date is a string-mode `date`
      // and goes in as "YYYY-MM-DD" (see below).
      deadline: options.deadline ? new Date(options.deadline) : null,
      parentTaskId: options.parentTaskId ?? null,
      recurrenceRule: options.recurrenceRule ?? null,
      recurrenceAnchor: options.recurrenceRule
        ? options.deadline
          ? new Date(options.deadline)
          : new Date()
        : null,
      sprintId: options.sprintId ?? null,
      description: options.description?.trim() ? options.description.trim() : null,
      priority: normalizePriority(options.priority),
      kind: placement.kind,
      projectId: placement.projectId,
      phaseId: placement.phaseId,
      area: normalizeOperativeArea(options.area),
      status: completion.status,
      isCompleted: completion.isCompleted,
      completedAt: completion.completedAt,
      // `|| null` so an empty string never reaches the `date` column.
      startDate: options.startDate || null,
    })
    .returning();

  if (options.recordIds && options.recordIds.length > 0) {
    await tx
      .insert(taskRecords)
      .values(options.recordIds.map((recordId) => ({ taskId: inserted.id, recordId })));
  }
  if (options.assigneeIds && options.assigneeIds.length > 0) {
    await tx
      .insert(taskAssignees)
      .values(options.assigneeIds.map((userId) => ({ taskId: inserted.id, userId })));
  }
  return inserted;
  });

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
    sprintId?: string | null;
    description?: string | null;
    priority?: string | null;
    kind?: string | null;
    projectId?: string | null;
    phaseId?: string | null;
    area?: string | null;
    status?: string | null;
    startDate?: string | null;
    /** Re-parent. Spec §11 — crm_update_task sends this. */
    parentTaskId?: string | null;
  },
  /**
   * Who performed the edit. OPTIONAL, unlike the project services: this
   * function has pre-existing callers (`services/agent/agent-tasks.ts` and
   * the PATCH route) and a required parameter would break them. Routes pass
   * `ctx.userId`; a machine path may legitimately pass null.
   */
  actorUserId: string | null = null,
) {
  const [existing] = await db
    .select({
      id: tasks.id,
      parentTaskId: tasks.parentTaskId,
      kind: tasks.kind,
      projectId: tasks.projectId,
      phaseId: tasks.phaseId,
      status: tasks.status,
      isCompleted: tasks.isCompleted,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return null;

  const currentPlacement: TaskPlacement = {
    kind: normalizeTaskKind(existing.kind) ?? (existing.projectId ? "projekt" : "operativ"),
    projectId: existing.projectId ?? null,
    phaseId: existing.phaseId ?? null,
  };
  const requested: { kind?: unknown; projectId?: unknown; phaseId?: unknown } = {};
  if (updates.kind !== undefined) requested.kind = updates.kind;
  if (updates.projectId !== undefined) requested.projectId = updates.projectId;
  if (updates.phaseId !== undefined) requested.phaseId = updates.phaseId;
  let placement = resolveTaskKind(requested, currentPlacement);

  // I4 on re-parent: a task moved under a new parent inherits that parent's
  // kind / project / phase, overriding whatever the caller sent.
  const reparented =
    updates.parentTaskId !== undefined &&
    (updates.parentTaskId || null) !== (existing.parentTaskId ?? null);
  if (reparented) {
    const newParentId = updates.parentTaskId || null;
    if (newParentId === taskId) {
      throw new TaskInvariantError("Eine Aufgabe kann nicht ihre eigene Unteraufgabe sein");
    }
    let parentRow:
      | {
          kind: string | null;
          projectId: string | null;
          phaseId: string | null;
          parentTaskId: string | null;
        }
      | null = null;
    if (newParentId) {
      const [row] = await db
        .select({
          kind: tasks.kind,
          projectId: tasks.projectId,
          phaseId: tasks.phaseId,
          parentTaskId: tasks.parentTaskId,
        })
        .from(tasks)
        .where(and(eq(tasks.id, newParentId), eq(tasks.workspaceId, workspaceId)))
        .limit(1);
      if (!row) throw new TaskInvariantError("Übergeordnete Aufgabe nicht gefunden");
      const eligible = resolveParentEligibility(row);
      if (!eligible.ok) throw new TaskInvariantError(eligible.error);
      parentRow = row;
    }

    // A task that already HAS children cannot itself become a child, for the
    // same reason: its children would silently become grandchildren.
    if (newParentId) {
      const [child] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.parentTaskId, taskId)))
        .limit(1);
      const childEligible = resolveChildEligibility(!!child);
      if (!childEligible.ok) throw new TaskInvariantError(childEligible.error);
    }

    placement = resolveInheritedPlacement(parentRow, placement);
  }

  await assertPhaseBelongsToProject(workspaceId, placement);

  const currentCompletion: TaskCompletion = {
    status: normalizeTaskStatus(existing.status) ?? (existing.isCompleted ? "erledigt" : "geplant"),
    isCompleted: existing.isCompleted,
    completedAt: existing.completedAt,
  };
  const statusPatch: { status?: unknown; isCompleted?: unknown } = {};
  if (updates.status !== undefined) statusPatch.status = updates.status;
  if (updates.isCompleted !== undefined) statusPatch.isCompleted = updates.isCompleted;
  const completion = resolveTaskStatus(statusPatch, currentCompletion);

  const setValues: Record<string, unknown> = {};
  if (updates.content !== undefined) setValues.content = updates.content;
  if (updates.deadline !== undefined) {
    setValues.deadline = updates.deadline ? new Date(updates.deadline) : null;
    // Re-arm the overdue cron for the new deadline.
    setValues.overdueNotifiedAt = null;
  }
  if (updates.startDate !== undefined) {
    // `date` column in string mode — no conversion on the way in.
    setValues.startDate = updates.startDate || null;
  }
  if (updates.recurrenceRule !== undefined) setValues.recurrenceRule = updates.recurrenceRule;
  if (updates.sprintId !== undefined) {
    // Empty string from the form means "Kein Sprint".
    setValues.sprintId = updates.sprintId ? updates.sprintId : null;
  }
  if (updates.description !== undefined) {
    setValues.description = updates.description?.trim() ? updates.description.trim() : null;
  }
  if (updates.priority !== undefined) setValues.priority = normalizePriority(updates.priority);
  if (updates.area !== undefined) setValues.area = normalizeOperativeArea(updates.area);
  if (updates.parentTaskId !== undefined) {
    setValues.parentTaskId = updates.parentTaskId || null;
  }

  const placementChanged =
    placement.kind !== currentPlacement.kind ||
    placement.projectId !== currentPlacement.projectId ||
    placement.phaseId !== currentPlacement.phaseId;
  if (placementChanged) {
    setValues.kind = placement.kind;
    setValues.projectId = placement.projectId;
    setValues.phaseId = placement.phaseId;
  }

  const completionChanged =
    completion.status !== currentCompletion.status ||
    completion.isCompleted !== currentCompletion.isCompleted;
  if (completionChanged) {
    setValues.status = completion.status;
    setValues.isCompleted = completion.isCompleted;
    setValues.completedAt = completion.completedAt;
  }

  // ONE transaction for the row, the I4 cascade and the two replace-lists.
  // Delete-then-insert on assignees/records is only safe inside one: a failed
  // insert used to leave the task with ZERO assignees, permanently.
  const committed = await db.transaction(async (tx) => {
    if (Object.keys(setValues).length > 0) {
      const [updated] = await tx
        .update(tasks)
        .set(setValues)
        .where(eq(tasks.id, taskId))
        .returning({ id: tasks.id });
      if (!updated) return false;
    }

    // I4: moving a parent drags its subtasks along. Depth is capped at two
    // levels (resolveParentEligibility), so one level of cascade is complete.
    if (placementChanged) {
      await tx
        .update(tasks)
        .set({
          kind: placement.kind,
          projectId: placement.projectId,
          phaseId: placement.phaseId,
        })
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.parentTaskId, taskId)));
    }

    if (updates.recordIds !== undefined) {
      await tx.delete(taskRecords).where(eq(taskRecords.taskId, taskId));
      if (updates.recordIds.length > 0) {
        await tx
          .insert(taskRecords)
          .values(updates.recordIds.map((recordId) => ({ taskId, recordId })));
      }
    }
    if (updates.assigneeIds !== undefined) {
      await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
      if (updates.assigneeIds.length > 0) {
        await tx
          .insert(taskAssignees)
          .values(updates.assigneeIds.map((userId) => ({ taskId, userId })));
      }
    }
    return true;
  });
  if (!committed) return null;

  // Activity trail for the two task-level literals of spec §10.1. emitEvent
  // ONLY — a task edit must never fan out to every workspace member. The
  // event is filed under the project so it shows in the project's
  // Aktivitäten tab; the task id travels in the payload. Which events fire,
  // on which transitions, is decided entirely by the pure
  // planTaskActivityEmissions above — this loop just executes its output.
  const activityEmissions = planTaskActivityEmissions({
    taskId,
    placementChanged,
    completionChanged,
    currentPlacement,
    placement,
    currentCompletion,
    completion,
  });
  for (const emission of activityEmissions) {
    await emitEvent({
      workspaceId,
      recordId: emission.recordId,
      objectSlug: "projects",
      eventType: emission.eventType,
      actorId: actorUserId,
      payload: emission.payload,
    });
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return null;
  return (await enrichTasks([task]))[0];
}

export async function deleteTask(taskId: string, workspaceId: string) {
  // `tasks.parent_task_id` has NO foreign key (db/schema/tasks.ts:18), so
  // deleting a parent used to leave its children pointing at a row that no
  // longer exists: invisible in every top-level list (the `parentTaskId IS
  // NULL` filter hides them), still counted by computeProjectStats, and
  // unreachable in the UI. Delete the children with the parent, in ONE
  // transaction, together with every dependency edge that touches either.
  return db.transaction(async (tx) => {
    const children = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.parentTaskId, taskId)));
    const doomed = [taskId, ...children.map((c) => c.id)];

    // Belt and braces: task_dependencies.{predecessor,successor}_task_id are
    // specified ON DELETE CASCADE (spec §4.8), but an edge surviving a missing
    // constraint would draw a timeline arrow to a bar that does not exist.
    await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.workspaceId, workspaceId),
          or(
            inArray(taskDependencies.predecessorTaskId, doomed),
            inArray(taskDependencies.successorTaskId, doomed),
          ),
        ),
      );

    if (children.length > 0) {
      await tx
        .delete(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.parentTaskId, taskId)));
    }

    const [task] = await tx
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
      .returning();
    return task;
  });
}

// ─── Route error conversion ────────────────────────────────────────────
//
// createTask / updateTask throw five distinct German messages, from four
// different guards (resolvePhaseAssignment, resolveParentEligibility,
// resolveChildEligibility, and the self-parent check in updateTask). Every
// one of them is a `TaskInvariantError` with a message meant to be shown,
// not logged. A route that catches by matching literal strings against a
// hand-copied allowlist will silently 500 on any message the allowlist
// forgot — and the next invariant this file grows would reintroduce the
// bug. Route this through ONE conversion instead of a list.
//
// F2: this used to pass ANY `Error` through as a 400 — which meant a driver
// failure (bad timestamp syntax, a dropped connection) surfaced as "your
// input was wrong" with the raw Postgres string in the response, and
// nothing logged server-side. Only a `TaskInvariantError` is a caller
// mistake; everything else is the route's job to log and turn into a fixed
// 500, so `null` here is the route's signal to do that.

/**
 * Pure: turn whatever createTask/updateTask threw into the message a 400
 * response shows, or `null` if this was NOT one of the five invariant
 * errors (i.e. the route must log it and return a 500 instead). Only a
 * `TaskInvariantError` passes through — that boundary is what keeps a raw
 * driver/Postgres message from ever reaching the client as a "your input
 * was wrong" 400.
 */
export function describeTaskRouteError(err: unknown): string | null {
  return err instanceof TaskInvariantError ? err.message : null;
}
