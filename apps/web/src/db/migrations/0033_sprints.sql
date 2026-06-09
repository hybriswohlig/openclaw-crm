-- Sprints: a thin, optional time box layered over the existing Aufgaben
-- board (Scrumban). A sprint is just a named window with one goal; tasks
-- opt in via tasks.sprint_id. NULL sprint_id = product backlog / pure flow,
-- which is where every existing task stays after this migration runs, so
-- nothing changes for current data.
CREATE TABLE IF NOT EXISTS "sprints" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "goal" text,
  -- 'planung' | 'aktiv' | 'abgeschlossen' (app-enforced, not a DB enum)
  "state" text NOT NULL DEFAULT 'planung',
  "start_date" timestamp,
  "end_date" timestamp,
  "capacity_points" integer,
  -- Snapshots written once at close so velocity history survives carry-over.
  "committed_points" integer,
  "completed_points" integer,
  "carried_tasks" integer,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "sprints_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "sprints_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "sprints_workspace_id" ON "sprints" ("workspace_id");
CREATE INDEX IF NOT EXISTS "sprints_workspace_state" ON "sprints" ("workspace_id", "state");

-- Sprint membership + work classification on tasks. All nullable so every
-- existing row reads as: not in a sprint, flow work, no growth category.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "sprint_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "work_type" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "growth_category" text;

-- ON DELETE SET NULL: deleting a sprint returns its tasks to flow rather
-- than cascading them away. Guarded so a re-run does not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_sprint_id_sprints_id_fk'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_sprint_id_sprints_id_fk"
      FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tasks_sprint_id" ON "tasks" ("sprint_id");
