-- Projekte & Operative Aufgaben — Datenschicht.
-- Spec: docs/superpowers/specs/2026-08-21-projekte-operative-aufgaben-design.md §4.
--
-- Nine new tables plus six discriminator columns on `tasks`. Hand written and
-- idempotent (pattern: 0033_sprints.sql) so a re-run is a no-op. Every enum-like
-- column is plain `text`; validation lives in the service layer via the
-- normalizeX() helpers in src/lib/project-constants.ts. Money is integer cents,
-- EUR only. Deliberately written without drizzle breakpoint markers, matching
-- 0033, so the whole file runs as a single statement.

-- ── projects ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "projects" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  -- Kurzbeschreibung. Required in the UI, nullable in the DB so an AI or a
  -- script can create a stub project and fill it in afterwards.
  "short_description" text,
  -- PROJECT_CATEGORIES, e.g. 'software' | 'gruendung' | 'finanzen'.
  "category" text NOT NULL,
  -- PRIORITIES: 'sehr_hoch' | 'hoch' | 'mittel' | 'niedrig'.
  "priority" text NOT NULL DEFAULT 'mittel',
  -- PROJECT_STATUS: 'geplant' | 'aktiv' | 'pausiert' | 'abgeschlossen' | 'abgebrochen'.
  "status" text NOT NULL DEFAULT 'geplant',
  -- lucide-react icon name, e.g. 'Wrench'. NULL = derive from the category.
  "icon" text,
  -- Hex colour of the icon tile and the timeline row. NULL = derive.
  "color" text,
  "start_date" date,
  "end_date" date,
  "owner_user_id" text,
  "problem_statement" text,
  "goal_statement" text,
  "success_criteria" text,
  -- string[] bullet lists: "Im Projekt enthalten" / "Nicht im Projekt enthalten".
  "scope_in" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "scope_out" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Budget frame in integer cents. NULL = no budget tracked, no percentage shown.
  "budget_planned_cents" integer,
  -- TipTap document behind the "Notizen" tab. NULL = empty.
  "notes_content" jsonb,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  -- Soft delete / archive. NULL = live project.
  "archived_at" timestamp,
  CONSTRAINT "projects_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "projects_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "projects_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "projects_workspace_id" ON "projects" ("workspace_id");
CREATE INDEX IF NOT EXISTS "projects_workspace_status" ON "projects" ("workspace_id", "status");

-- ── project_phases ("Arbeitsbereiche") ────────────────────────────────
CREATE TABLE IF NOT EXISTS "project_phases" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  -- Manual sort order inside the project, 0-based, rewritten by reorderPhases.
  "position" integer NOT NULL DEFAULT 0,
  -- PHASE_STATUS: 'geplant' | 'in_arbeit' | 'abgeschlossen'.
  "status" text NOT NULL DEFAULT 'geplant',
  "start_date" date,
  "due_date" date,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_phases_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_phases_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "project_phases_project_position" ON "project_phases" ("project_id", "position");

-- ── project_milestones ────────────────────────────────────────────────
-- Deliberately independent of phases: the mockup shows a milestone with no
-- phase of its own, and the KPI tile counts differently from the phase list.
CREATE TABLE IF NOT EXISTS "project_milestones" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  -- Optional anchor to a phase. SET NULL so deleting a phase keeps the milestone.
  "phase_id" text,
  "name" text NOT NULL,
  "due_date" date,
  -- MILESTONE_STATUS: 'geplant' | 'erreicht' | 'verfehlt'.
  "status" text NOT NULL DEFAULT 'geplant',
  "position" integer NOT NULL DEFAULT 0,
  "reached_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_milestones_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_milestones_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_milestones_phase_id_project_phases_id_fk"
    FOREIGN KEY ("phase_id") REFERENCES "project_phases"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "project_milestones_project_position" ON "project_milestones" ("project_id", "position");

-- ── project_members ───────────────────────────────────────────────────
-- Pattern: deal_employees. The project lead (projects.owner_user_id) is ALSO
-- written here with role 'leiter' so avatar stacks have a single source.
CREATE TABLE IF NOT EXISTS "project_members" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "user_id" text NOT NULL,
  -- PROJECT_MEMBER_ROLE: 'leiter' | 'mitglied' | 'beobachter'. Display and
  -- responsibility only — never access control (spec §10.5).
  "role" text NOT NULL DEFAULT 'mitglied',
  "created_at" timestamp DEFAULT now() NOT NULL,
  -- A real UNIQUE constraint, not just a unique index: the services insert
  -- memberships with ON CONFLICT DO NOTHING against exactly this target.
  CONSTRAINT "project_members_project_user_uniq" UNIQUE ("project_id", "user_id"),
  CONSTRAINT "project_members_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_members_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- Lookups by project_id ride the UNIQUE constraint's own index, which leads
-- with that column; only the reverse direction ("which projects is this user
-- on?") needs an index of its own.
CREATE INDEX IF NOT EXISTS "project_members_user_id" ON "project_members" ("user_id");

-- ── project_risks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "project_risks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  -- RISK_SEVERITY: 'niedrig' | 'mittel' | 'hoch'.
  "severity" text NOT NULL DEFAULT 'mittel',
  -- Same scale as severity, optional.
  "likelihood" text,
  -- RISK_STATUS: 'offen' | 'beobachtet' | 'geschlossen'.
  "status" text NOT NULL DEFAULT 'offen',
  "mitigation" text,
  "owner_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_risks_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_risks_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_risks_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "project_risks_project_id" ON "project_risks" ("project_id");

-- ── project_budget_entries ────────────────────────────────────────────
-- projects.budget_planned_cents is the frame (the KPI denominator).
-- kind='ist' rows sum to the spend; kind='plan' rows are the optional
-- breakdown of the frame and never count as spend.
CREATE TABLE IF NOT EXISTS "project_budget_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "label" text NOT NULL,
  -- Integer cents, EUR. May be negative (a correction / refund).
  "amount_cents" integer NOT NULL,
  -- BUDGET_ENTRY_KIND: 'plan' | 'ist'.
  "kind" text NOT NULL,
  "booked_at" date,
  "note" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_budget_entries_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_budget_entries_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_budget_entries_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "project_budget_entries_project_id" ON "project_budget_entries" ("project_id");
CREATE INDEX IF NOT EXISTS "project_budget_entries_project_kind" ON "project_budget_entries" ("project_id", "kind");

-- ── project_documents ─────────────────────────────────────────────────
-- Limits exactly as deal_documents: base64 in Postgres, 10 MB cap enforced in
-- the service, and the list query must never select file_content.
CREATE TABLE IF NOT EXISTS "project_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "file_name" text NOT NULL,
  -- bytes
  "file_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  -- base64
  "file_content" text NOT NULL,
  "uploaded_by" text,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_documents_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_documents_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_documents_uploaded_by_users_id_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "project_documents_project_id" ON "project_documents" ("project_id");

-- ── task_dependencies ─────────────────────────────────────────────────
-- Feeds the dependency arrows of the sprint timeline. Cycles are rejected in
-- the service (DFS over the workspace's edges) with 400 BAD_REQUEST — Postgres
-- cannot express that constraint.
CREATE TABLE IF NOT EXISTS "task_dependencies" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "predecessor_task_id" text NOT NULL,
  "successor_task_id" text NOT NULL,
  -- Only 'finish_start' is used today; the column exists so start_start and
  -- friends do not need a migration later.
  "type" text NOT NULL DEFAULT 'finish_start',
  "created_at" timestamp DEFAULT now() NOT NULL,
  -- A real UNIQUE constraint (spec §4.8), so adding the same edge twice is a
  -- no-op the service can express as ON CONFLICT DO NOTHING.
  CONSTRAINT "task_dependencies_pair_uniq" UNIQUE ("predecessor_task_id", "successor_task_id"),
  CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "task_dependencies_predecessor_task_id_tasks_id_fk"
    FOREIGN KEY ("predecessor_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "task_dependencies_successor_task_id_tasks_id_fk"
    FOREIGN KEY ("successor_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE
);

-- The UNIQUE constraint's index already serves predecessor lookups (it leads
-- with that column), so only the successor direction and the workspace scan
-- need indexes of their own.
CREATE INDEX IF NOT EXISTS "task_dependencies_workspace_id" ON "task_dependencies" ("workspace_id");
CREATE INDEX IF NOT EXISTS "task_dependencies_successor_id" ON "task_dependencies" ("successor_task_id");

-- ── project_favorites ─────────────────────────────────────────────────
-- Module-internal favourites list and the star in the project header. The app
-- sidebar stays untouched.
CREATE TABLE IF NOT EXISTS "project_favorites" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "project_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  -- A real UNIQUE constraint, and the load bearing one: setProjectFavorite
  -- inserts with ON CONFLICT (user_id, project_id) DO NOTHING. Without this,
  -- that clause has no target to infer, and a double clicked star writes two
  -- rows.
  CONSTRAINT "project_favorites_user_project_uniq" UNIQUE ("user_id", "project_id"),
  CONSTRAINT "project_favorites_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_favorites_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "project_favorites_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);

-- Lookups by user_id ride the UNIQUE constraint's index; the reverse
-- direction ("who favourited this project?") needs its own.
CREATE INDEX IF NOT EXISTS "project_favorites_project_id" ON "project_favorites" ("project_id");

-- ── tasks: the six discriminator columns (spec §4.10) ─────────────────
-- Defaults are chosen so every one of the 222 existing rows reads as a plain
-- operative task with no project and no start date.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'operativ';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "phase_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "area" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'geplant';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "start_date" date;

-- ON DELETE SET NULL on both: deleting a project or a phase returns its tasks
-- to the operative list instead of cascading them away. Guarded so a re-run
-- does not error (pattern: 0033_sprints.sql).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_phase_id_project_phases_id_fk'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_phase_id_project_phases_id_fk"
      FOREIGN KEY ("phase_id") REFERENCES "project_phases"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Invariant I3 (status='erledigt' <=> is_completed) must hold the moment the
-- column exists, otherwise the 129 already completed tasks would read as
-- 'geplant' until the data migration script runs.
--
-- I3 is an equivalence, not an implication, so the reconciliation runs in BOTH
-- directions. A one-sided "set 'erledigt' where is_completed AND status =
-- 'geplant'" would skip a row that is completed but was hand-set to
-- 'in_arbeit', and would never repair a row left at 'erledigt' after
-- is_completed went back to false. Both states are reachable once Phase 2
-- ships and this file is re-run, and both fail the gate query below. The pair
-- as written is genuinely idempotent: after it runs,
-- SELECT count(*) FROM tasks WHERE (status = 'erledigt') <> is_completed
-- returns 0, and a second run changes no row.
UPDATE "tasks" SET "status" = 'erledigt' WHERE "is_completed" = true  AND "status" <> 'erledigt';
UPDATE "tasks" SET "status" = 'geplant'  WHERE "is_completed" = false AND "status"  = 'erledigt';

CREATE INDEX IF NOT EXISTS "tasks_project_id" ON "tasks" ("project_id");
CREATE INDEX IF NOT EXISTS "tasks_phase_id" ON "tasks" ("phase_id");
CREATE INDEX IF NOT EXISTS "tasks_workspace_kind" ON "tasks" ("workspace_id", "kind");
CREATE INDEX IF NOT EXISTS "tasks_workspace_status" ON "tasks" ("workspace_id", "status");

-- ── sprints: what the stored point columns mean (spec §7, risk R6) ────
-- This release converts sprint metrics from Fibonacci story points to task
-- counts. Sprints closed BEFORE the conversion still hold point sums in
-- committed_points / completed_points. Reading those as task counts would
-- render "13 von 22 Aufgaben, 62 %" forever: a real looking number that is
-- simply false. Production has one such sprint, "Sprint Nr. 1" from June.
--
-- They cannot be recomputed. closeSprint sets sprint_id = NULL on every
-- unfinished task, so for an already closed sprint the denominator — how many
-- tasks it contained — no longer exists anywhere in the data. A recompute
-- could reconstruct the numerator and would have to invent the denominator.
-- So the historical numbers stay untouched, this marker records what they
-- mean, and the UI renders "–" wherever it reads 'points'.
--
-- The ADD COLUMN and the backfill sit inside one guard on purpose. Order
-- matters twice over: the UPDATE reads metrics_basis, so it can never run
-- before the ADD COLUMN; and the backfill must only ever see the rows that
-- existed when the column was born. A bare
--   UPDATE sprints SET metrics_basis='points'
--   WHERE state='abgeschlossen' AND metrics_basis='tasks'
-- converges, but on a manual re-run after Phase 2 has shipped it would also
-- relabel every sprint closed since — which are genuinely task based — as
-- points, inventing exactly the false number this column exists to prevent.
-- Skipping the whole block once the column exists is idempotent AND correct.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sprints' AND column_name = 'metrics_basis'
  ) THEN
    ALTER TABLE "sprints" ADD COLUMN "metrics_basis" text NOT NULL DEFAULT 'tasks';
    -- Every row that exists at this moment predates the conversion, so each
    -- closed one is a points sprint. Open ones keep the 'tasks' default: they
    -- will be closed by the new, count based code.
    UPDATE "sprints" SET "metrics_basis" = 'points' WHERE "state" = 'abgeschlossen';
  END IF;
END $$;
