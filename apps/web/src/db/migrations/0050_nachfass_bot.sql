-- Nachfass-Bot: Zustand pro Deal, Auto-Send-Schalter pro Regel und Firma
-- (Default AUS, keine Zeile wird eingeschaltet) und Tageszähler.
-- Additiv und idempotent. Hängt nur an records und workspaces, nicht an
-- den Tabellen der Deal-Anreicherung.

CREATE TABLE IF NOT EXISTS "nachfass_deal_state" (
  "deal_record_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "operating_company_record_id" text,
  "stop_reason" text,
  "fresh_started_at" timestamp,
  "fu1_sent_at" timestamp,
  "fu2_sent_at" timestamp,
  "close_sent_at" timestamp,
  "rule_c_sent_at" timestamp,
  "legacy_fu_sent_at" timestamp,
  "legacy_close_sent_at" timestamp,
  "team_reminders" integer NOT NULL DEFAULT 0,
  "last_team_reminder_at" timestamp,
  "triage_at" timestamp,
  "triage_outcome" text,
  "triage_note" text,
  "infos_complete_at" timestamp,
  "next_action_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "nachfass_deal_state_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "nachfass_deal_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nachfass_deal_state_ws_idx" ON "nachfass_deal_state" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nachfass_deal_state_next_idx" ON "nachfass_deal_state" ("next_action_at") WHERE "next_action_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nachfass_rule_switches" (
  "workspace_id" text NOT NULL,
  "operating_company_record_id" text NOT NULL DEFAULT '',
  "rule" text NOT NULL,
  "auto_send" boolean NOT NULL DEFAULT false,
  "clean_approvals" integer NOT NULL DEFAULT 0,
  "corrected_approvals" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "nachfass_rule_switches_pkey" PRIMARY KEY ("workspace_id", "operating_company_record_id", "rule"),
  CONSTRAINT "nachfass_rule_switches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nachfass_daily_sends" (
  "workspace_id" text NOT NULL,
  "channel_account_id" text NOT NULL,
  "berlin_day" date NOT NULL,
  "sent_count" integer NOT NULL DEFAULT 0,
  "legacy_drafts" integer NOT NULL DEFAULT 0,
  CONSTRAINT "nachfass_daily_sends_pkey" PRIMARY KEY ("workspace_id", "channel_account_id", "berlin_day"),
  CONSTRAINT "nachfass_daily_sends_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
