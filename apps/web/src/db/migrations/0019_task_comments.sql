CREATE TABLE IF NOT EXISTS "task_comments" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "task_comments_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "task_comments_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "task_comments_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "task_comments_task_id" ON "task_comments" ("task_id");
CREATE INDEX IF NOT EXISTS "task_comments_workspace_id" ON "task_comments" ("workspace_id");
