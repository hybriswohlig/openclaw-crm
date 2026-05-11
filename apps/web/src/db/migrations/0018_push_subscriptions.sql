CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "device_label" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "push_subscriptions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "push_subscriptions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subs_endpoint_unique"
  ON "push_subscriptions" ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subs_user_idx"
  ON "push_subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "push_subs_workspace_idx"
  ON "push_subscriptions" ("workspace_id");
