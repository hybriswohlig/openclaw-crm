import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
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
}, (table) => [
  index("tasks_workspace_id").on(table.workspaceId),
  index("tasks_parent_task_id").on(table.parentTaskId),
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
