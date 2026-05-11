-- Per-deal log row used by the nightly "In Kontakt" auto-refresh cron to
-- decide whether to re-run extraction. Skipping deals where no new inbox
-- message has arrived since the last run saves OpenRouter tokens.

CREATE TABLE IF NOT EXISTS "deal_insights_refresh_log" (
  "deal_record_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "refreshed_at" timestamp DEFAULT now() NOT NULL,
  "last_message_at_seen" timestamp,
  "fields_updated" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "deal_insights_refresh_log_deal_record_id_fk"
    FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "deal_insights_refresh_log_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "deal_insights_refresh_log_workspace_idx"
  ON "deal_insights_refresh_log" ("workspace_id");
