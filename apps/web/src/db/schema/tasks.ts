import { pgTable, text, timestamp, boolean, index, integer, date } from "drizzle-orm/pg-core";
import { records } from "./records";
import { users } from "./auth";
import { workspaces } from "./workspace";

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  content: text("content").notNull(),
  deadline: timestamp("deadline"),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Subtask link — null for top-level, points at the parent task otherwise.
  parentTaskId: text("parent_task_id"),
  // 'daily' | 'weekly' | 'monthly' | null. Cron materialises the next
  // instance once the current one is marked completed.
  recurrenceRule: text("recurrence_rule"),
  recurrenceAnchor: timestamp("recurrence_anchor"),
  // Set by /api/cron/check-overdue-tasks once it has notified the team
  // about a missed deadline. Cleared when the deadline is edited.
  overdueNotifiedAt: timestamp("overdue_notified_at"),
  // Explicit kanban column set by drag-drop. Null = derive from
  // isCompleted/deadline/linkedRecords. Values: backlog | heute |
  // laeuft | warte | erledigt.
  kanbanStatus: text("kanban_status"),
  // Fibonacci size estimate (1,2,3,5,8,13). Drives the Team-Pulse points
  // scoring. Nullable — old tasks default to 1 in aggregation. Parent tasks
  // with subtasks: their points are NOT scored on completion; only leaf
  // tasks score. This keeps "many small tasks" and "one big task with
  // subtasks" fairly comparable.
  pointEstimate: integer("point_estimate"),
  // Sprint membership. NULL = product backlog / pure flow (the default and
  // the only state any pre-existing task is ever in). A set sprintId puts
  // the task into that sprint's backlog and lets it count toward the
  // sprint's velocity. ON DELETE SET NULL so deleting a sprint returns its
  // tasks to flow instead of cascading them away.
  sprintId: text("sprint_id"),
  // Work classification tag, independent of sprint membership.
  // NULL / 'flow' = laufender Betrieb (daily operations). 'build' = Wachstum
  // (a finite grow-the-company initiative). The migration leaves this NULL
  // so every existing task reads as flow. This is a label for filtering and
  // reporting only; it does NOT gate sprint velocity (sprint membership does).
  workType: text("work_type"),
  // Sub-bucket of a 'build' task, e.g. 'vertrieb' | 'marketing' | 'hiring'.
  // Validated against a constant in the service. Only meaningful for build
  // work; NULL otherwise.
  growthCategory: text("growth_category"),
  // Free-text details beyond the one-line title. NULL = no description.
  description: text("description"),
  // 'sehr_hoch' | 'hoch' | 'mittel' | 'niedrig' | NULL. Validated in the
  // service through normalizePriority().
  priority: text("priority"),
  // ─── Work model (spec §4.10) ────────────────────────────────────────
  // 'projekt' | 'operativ'. Invariant I1: kind='projekt' <=> projectId IS NOT
  // NULL, enforced in services/tasks.ts. Defaults to 'operativ' so every
  // pre-existing row reads as running business with no project.
  kind: text("kind").notNull().default("operativ"),
  // The owning project. No .references() here on purpose: the FK lives in
  // 0044_projects.sql (ON DELETE SET NULL), and keeping it out of the ORM
  // avoids an import cycle with schema/projects.ts, which references tasks.id
  // for task_dependencies. Same treatment as sprintId and parentTaskId.
  projectId: text("project_id"),
  // The phase ("Arbeitsbereich") inside that project. Invariant I2: the phase
  // must belong to projectId, checked in the service. FK in SQL only.
  phaseId: text("phase_id"),
  // OPERATIVE_AREAS tag, e.g. 'auftrag' | 'schaden' | 'buchhaltung'. Only
  // meaningful for kind='operativ'; NULL otherwise.
  area: text("area"),
  // 'geplant' | 'in_arbeit' | 'erledigt'. Invariant I3: status='erledigt' <=>
  // isCompleted. `status` is the business-leading field, isCompleted the
  // compatibility mirror that 35 existing files still read.
  status: text("status").notNull().default("geplant"),
  // Bar start in the sprint timeline. NULL = derive from deadline/createdAt.
  startDate: date("start_date"),
}, (table) => [
  index("tasks_workspace_id").on(table.workspaceId),
  index("tasks_parent_task_id").on(table.parentTaskId),
  index("tasks_sprint_id").on(table.sprintId),
  index("tasks_project_id").on(table.projectId),
  index("tasks_phase_id").on(table.phaseId),
  index("tasks_workspace_kind").on(table.workspaceId, table.kind),
  index("tasks_workspace_status").on(table.workspaceId, table.status),
]);

export const taskRecords = pgTable(
  "task_records",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("task_records_task_id").on(table.taskId),
    index("task_records_record_id").on(table.recordId),
  ]
);

export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("task_assignees_task_id").on(table.taskId),
    index("task_assignees_user_id").on(table.userId),
  ]
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("task_comments_task_id").on(table.taskId),
    index("task_comments_workspace_id").on(table.workspaceId),
  ]
);
