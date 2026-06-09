import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { workspaces } from "./workspace";

// ─── Sprints ──────────────────────────────────────────────────────────
//
// A Sprint is a thin, OPTIONAL time box that sits on top of the existing
// Aufgaben (task) board. It is NOT a second board engine: the 5-column
// Kanban (backlog/heute/laeuft/warte/erledigt) stays exactly as it was.
// A sprint is just a named window with one goal. Tasks point at a sprint
// via tasks.sprintId; a NULL sprintId means the task lives in pure flow
// (the product backlog / daily operations) exactly like before.
//
// This is a deliberate Scrumban design for a small moving company: the
// office uses sprints for finite "build / grow the company" initiatives,
// while day-to-day move jobs keep running as flow with zero ceremony.
//
// Single-active invariant: at most one sprint per workspace is in state
// 'aktiv'. This is enforced in the service layer (activateSprint), not by
// a DB constraint.
export const sprints = pgTable(
  "sprints",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Human label, e.g. "Sprint KW24" or "Q3 Wachstum".
    name: text("name").notNull(),
    // The one-sentence Sprintziel. This is the commitment; the task list
    // is only a forecast. Nullable so a sprint can be drafted before the
    // goal is phrased.
    goal: text("goal"),
    // 'planung' (being filled) | 'aktiv' (running) | 'abgeschlossen' (closed).
    // App-enforced, not a DB enum, so the set can evolve without a migration.
    state: text("state").notNull().default("planung"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    // Owner-set target for the sprint (a single number of points, NOT
    // per-person hours). Optional planning aid only.
    capacityPoints: integer("capacity_points"),
    // Snapshots written ONCE when the sprint is closed, so the velocity
    // history survives carry-over (which detaches unfinished tasks). Live
    // sprints compute these on the fly instead.
    committedPoints: integer("committed_points"),
    completedPoints: integer("completed_points"),
    carriedTasks: integer("carried_tasks"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("sprints_workspace_id").on(table.workspaceId),
    index("sprints_workspace_state").on(table.workspaceId, table.state),
  ]
);
