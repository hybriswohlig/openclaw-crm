import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  date,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { workspaces } from "./workspace";
import { tasks } from "./tasks";

// ─── Projects ─────────────────────────────────────────────────────────
//
// A Projekt is a finite, strategic initiative: goal, scope, phases,
// milestones, budget, risks, team and documents. Its counterpart is the
// operative task (tasks.kind = 'operativ'), which is running business with no
// project attached. Both live in the same `tasks` table; `tasks.kind` is the
// discriminator (invariant I1: kind='projekt' <=> project_id IS NOT NULL).
//
// Every enum-like column is plain text, validated in the service layer through
// the normalizeX() helpers of src/lib/project-constants.ts — the repo
// convention (see sprints.state). Money is integer cents, EUR only.
//
// `date` columns are read and written as "YYYY-MM-DD" strings (Drizzle's
// default mode, same as employee-ledger.ts); the services convert to Date.
export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Kurzbeschreibung. Required in the UI, nullable here so a stub project can
    // be created by a script or an agent and filled in afterwards.
    shortDescription: text("short_description"),
    // PROJECT_CATEGORIES, e.g. 'software' | 'gruendung' | 'finanzen'.
    category: text("category").notNull(),
    // PRIORITIES: 'sehr_hoch' | 'hoch' | 'mittel' | 'niedrig'.
    priority: text("priority").notNull().default("mittel"),
    // PROJECT_STATUS: 'geplant' | 'aktiv' | 'pausiert' | 'abgeschlossen' | 'abgebrochen'.
    status: text("status").notNull().default("geplant"),
    // lucide-react icon name, e.g. 'Wrench'. NULL = derive from the category
    // via defaultProjectIcon().
    icon: text("icon"),
    // Hex colour of the icon tile and the timeline row. NULL = derive via
    // defaultProjectColor().
    color: text("color"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    problemStatement: text("problem_statement"),
    goalStatement: text("goal_statement"),
    successCriteria: text("success_criteria"),
    // Bullet lists "Im Projekt enthalten" / "Nicht im Projekt enthalten".
    scopeIn: jsonb("scope_in").$type<string[]>().notNull().default([]),
    scopeOut: jsonb("scope_out").$type<string[]>().notNull().default([]),
    // Budget frame in integer cents. NULL = no budget tracked and no percentage.
    budgetPlannedCents: integer("budget_planned_cents"),
    // TipTap document behind the "Notizen" tab (spec §10.4). NULL = empty.
    notesContent: jsonb("notes_content"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Soft delete / archive. NULL = live project.
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("projects_workspace_id").on(table.workspaceId),
    index("projects_workspace_status").on(table.workspaceId, table.status),
  ]
);

// ─── Phases ("Arbeitsbereiche") ───────────────────────────────────────
export const projectPhases = pgTable(
  "project_phases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Manual sort order inside the project, 0-based, rewritten by reorderPhases.
    position: integer("position").notNull().default(0),
    // PHASE_STATUS: 'geplant' | 'in_arbeit' | 'abgeschlossen'.
    status: text("status").notNull().default("geplant"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_phases_project_position").on(table.projectId, table.position),
  ]
);

// ─── Milestones ───────────────────────────────────────────────────────
//
// Deliberately independent of phases: the mockup shows a milestone with no
// phase of its own, and the KPI tile counts differently from the phase list.
export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Optional anchor to a phase. SET NULL so deleting the phase keeps the
    // milestone.
    phaseId: text("phase_id").references(() => projectPhases.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    dueDate: date("due_date"),
    // MILESTONE_STATUS: 'geplant' | 'erreicht' | 'verfehlt'.
    status: text("status").notNull().default("geplant"),
    position: integer("position").notNull().default(0),
    reachedAt: timestamp("reached_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_milestones_project_position").on(table.projectId, table.position),
  ]
);

// ─── Members ──────────────────────────────────────────────────────────
//
// Pattern: deal_employees. The project lead (projects.ownerUserId) is ALSO
// written here with role 'leiter' so avatar stacks have a single source.
export const projectMembers = pgTable(
  "project_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // PROJECT_MEMBER_ROLE: 'leiter' | 'mitglied' | 'beobachter'. Display and
    // responsibility only, never access control (spec §10.5).
    role: text("role").notNull().default("mitglied"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // A real UNIQUE constraint, not a unique index: the services insert with
    // ON CONFLICT DO NOTHING against exactly this target. Its own index leads
    // with projectId, so a separate project_members_project_id would be dead
    // weight — only the reverse direction gets one.
    unique("project_members_project_user_uniq").on(table.projectId, table.userId),
    index("project_members_user_id").on(table.userId),
  ]
);

// ─── Risks ────────────────────────────────────────────────────────────
export const projectRisks = pgTable(
  "project_risks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    // RISK_SEVERITY: 'niedrig' | 'mittel' | 'hoch'.
    severity: text("severity").notNull().default("mittel"),
    // Same scale as severity, optional.
    likelihood: text("likelihood"),
    // RISK_STATUS: 'offen' | 'beobachtet' | 'geschlossen'.
    status: text("status").notNull().default("offen"),
    mitigation: text("mitigation"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("project_risks_project_id").on(table.projectId)]
);

// ─── Budget entries ───────────────────────────────────────────────────
//
// projects.budgetPlannedCents is the frame (the KPI denominator). kind='ist'
// rows sum to the spend; kind='plan' rows are the optional breakdown of the
// frame and never count as spend.
export const projectBudgetEntries = pgTable(
  "project_budget_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    // Integer cents, EUR. May be negative (a correction / refund).
    amountCents: integer("amount_cents").notNull(),
    // BUDGET_ENTRY_KIND: 'plan' | 'ist'.
    kind: text("kind").notNull(),
    bookedAt: date("booked_at"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("project_budget_entries_project_id").on(table.projectId),
    index("project_budget_entries_project_kind").on(table.projectId, table.kind),
  ]
);

// ─── Documents ────────────────────────────────────────────────────────
//
// Limits exactly as deal_documents: base64 in Postgres, 10 MB cap enforced in
// the service, and the list query must never select fileContent.
export const projectDocuments = pgTable(
  "project_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(), // bytes
    mimeType: text("mime_type").notNull(),
    fileContent: text("file_content").notNull(), // base64
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("project_documents_project_id").on(table.projectId)]
);

// ─── Task dependencies ────────────────────────────────────────────────
//
// Feeds the dependency arrows of the sprint timeline. Cycles are rejected in
// the service (DFS over the workspace's edges) with 400 BAD_REQUEST — Postgres
// cannot express that constraint.
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    predecessorTaskId: text("predecessor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorTaskId: text("successor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // Only 'finish_start' is used today; the column exists so start_start and
    // friends do not need a migration later.
    type: text("type").notNull().default("finish_start"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Spec §4.8. The constraint's index leads with predecessorTaskId, so only
    // the successor direction needs one of its own.
    unique("task_dependencies_pair_uniq").on(table.predecessorTaskId, table.successorTaskId),
    index("task_dependencies_workspace_id").on(table.workspaceId),
    index("task_dependencies_successor_id").on(table.successorTaskId),
  ]
);

// ─── Favourites ───────────────────────────────────────────────────────
//
// Module-internal favourites list and the star in the project header. The app
// sidebar stays untouched.
export const projectFavorites = pgTable(
  "project_favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // The load bearing one: setProjectFavorite inserts with
    // ON CONFLICT (userId, projectId) DO NOTHING, so a double clicked star is
    // a no-op instead of a second row. Its index leads with userId.
    unique("project_favorites_user_project_uniq").on(table.userId, table.projectId),
    index("project_favorites_project_id").on(table.projectId),
  ]
);
