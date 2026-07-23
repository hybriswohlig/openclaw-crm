-- KI-Verkaufsassistent 2.0 substrate (Phase 0, docs/ai-sales-agent-plan.md).
-- Typed agent state replaces title regexes and JSONB caches: stage semantics on
-- statuses, per-deal ownership+cadence, qualification slots with provenance,
-- append-only event log (trigger-enforced), draft approval queue, consent
-- ledger, rollups, playbooks, A/B variants, eval harness tables, per-brand
-- agent profile columns, and voice-note transcript columns.

-- ── 1) Machine-readable stage semantics ──────────────────────────────────────
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "stage_category" text;
--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "is_terminal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Backfill from the known seeded titles (German prod set + duplicate English
-- seeds). Normalization mirrors normalizeStageTitle: lowercase, trailing
-- parenthetical dropped. Unmapped titles stay NULL → the agent gate fails
-- closed there until an operator assigns a category. Conservative default
-- pending team sign-off: 'Durchgeführt' = done_unpaid AND terminal.
UPDATE "statuses" SET
  "stage_category" = CASE lower(btrim(regexp_replace("title", '\s*\(.*\)\s*$', '')))
    WHEN 'neue anfrage' THEN 'open_new'
    WHEN 'inquiry' THEN 'open_new'
    WHEN 'in kontakt' THEN 'open_engaged'
    WHEN 'contacted' THEN 'open_engaged'
    WHEN 'information gathered' THEN 'open_engaged'
    WHEN 'quoted' THEN 'quoted'
    WHEN 'angebot' THEN 'quoted'
    WHEN 'geplant' THEN 'booked'
    WHEN 'planned' THEN 'booked'
    WHEN 'durchgeführt' THEN 'done_unpaid'
    WHEN 'done' THEN 'done_unpaid'
    WHEN 'bezahlt' THEN 'paid'
    WHEN 'paid' THEN 'paid'
    WHEN 'verloren' THEN 'lost'
    WHEN 'lost' THEN 'lost'
    ELSE NULL
  END
WHERE "stage_category" IS NULL;
--> statement-breakpoint
UPDATE "statuses" SET "is_terminal" = true
WHERE "stage_category" IN ('done_unpaid', 'paid', 'lost');
--> statement-breakpoint

-- ── 2) Per-deal agent state (sticky human ownership + cadence) ───────────────
CREATE TABLE IF NOT EXISTS "deal_agent_state" (
  "deal_record_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "operating_company_record_id" text,
  "human_owned" boolean NOT NULL DEFAULT false,
  "human_owned_by" text,
  "human_owned_at" timestamp,
  "human_released_at" timestamp,
  "sequence_id" text,
  "current_step" integer NOT NULL DEFAULT 0,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_action_at" timestamp,
  "last_outbound_at" timestamp,
  "stop_reason" text,
  "language" text NOT NULL DEFAULT 'de',
  "register" text,
  "window_expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "deal_agent_state_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "deal_agent_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "deal_agent_state_operating_company_record_id_records_id_fk" FOREIGN KEY ("operating_company_record_id") REFERENCES "records"("id") ON DELETE SET NULL,
  CONSTRAINT "deal_agent_state_human_owned_by_users_id_fk" FOREIGN KEY ("human_owned_by") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_agent_state_ws_idx" ON "deal_agent_state" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_agent_state_next_action_idx" ON "deal_agent_state" ("next_action_at") WHERE "next_action_at" IS NOT NULL;
--> statement-breakpoint

-- ── 3) Qualification slots (typed, provenance-bearing) ───────────────────────
CREATE TABLE IF NOT EXISTS "qualification_slots" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL,
  "slot_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'missing',
  "value_json" jsonb,
  "confidence" numeric(3, 2),
  "source_message_id" text,
  "asked_count" integer NOT NULL DEFAULT 0,
  "last_asked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "qualification_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "qualification_slots_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "qualification_slots_source_message_id_inbox_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "inbox_messages"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qualification_slots_deal_slot_idx" ON "qualification_slots" ("deal_record_id", "slot_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qualification_slots_ws_idx" ON "qualification_slots" ("workspace_id");
--> statement-breakpoint

-- ── 4) Append-only agent event log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_events" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "deal_record_id" text,
  "conversation_id" text,
  "engine" text NOT NULL,
  "event_type" text NOT NULL,
  "prompt_version" text,
  "playbook_version" text,
  "model_tag" text,
  "gate_results" jsonb,
  "payload" jsonb,
  "idempotency_key" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  -- deal_record_id deliberately has NO FK: an ON DELETE action would UPDATE or
  -- DELETE rows in this append-only table (blocked by the trigger below) and
  -- thereby break hard record deletion. The log outlives its subjects.
  CONSTRAINT "agent_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_ws_created_idx" ON "agent_events" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_deal_created_idx" ON "agent_events" ("deal_record_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_events_idempotency_idx" ON "agent_events" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
-- DB-enforced immutability. REVOKE alone does not bind the table owner (the
-- app connects as owner on Neon), so a trigger raises on UPDATE/DELETE.
-- Note: FK cascades fire row triggers too — that is why deal_record_id has no
-- FK (see above) and why deleting a WORKSPACE would require dropping this
-- trigger first, deliberately (single-workspace app; not a real flow).
CREATE OR REPLACE FUNCTION agent_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_events is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agent_events_no_update_delete" ON "agent_events";
--> statement-breakpoint
CREATE TRIGGER "agent_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "agent_events"
  FOR EACH ROW EXECUTE FUNCTION agent_events_immutable();
--> statement-breakpoint

-- ── 5) Draft approval queue ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_drafts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL,
  "conversation_id" text,
  "channel_account_id" text,
  "message_class" text NOT NULL,
  "draft_text" text NOT NULL,
  "final_text" text,
  "filter_verdicts" jsonb,
  "gate_results" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "reviewer_user_id" text,
  "reviewed_at" timestamp,
  "sequence_id" text,
  "sequence_step" integer,
  "idempotency_key" text,
  "expires_at" timestamp,
  "sent_message_id" text,
  "prompt_version" text,
  "playbook_version" text,
  "model_tag" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "agent_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_drafts_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_drafts_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "inbox_conversations"("id") ON DELETE SET NULL,
  CONSTRAINT "agent_drafts_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_drafts_ws_status_idx" ON "agent_drafts" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_drafts_deal_idx" ON "agent_drafts" ("deal_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_drafts_idempotency_idx" ON "agent_drafts" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

-- ── 6) Consent ledger (§7 UWG evidence) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "consent_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "person_record_id" text NOT NULL,
  "channel" text NOT NULL,
  "purpose" text NOT NULL,
  "exact_wording" text,
  "granted_at" timestamp NOT NULL DEFAULT now(),
  "source_message_id" text,
  "source_conversation_id" text,
  "revoked_at" timestamp,
  "revoked_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "consent_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "consent_ledger_person_record_id_records_id_fk" FOREIGN KEY ("person_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "consent_ledger_source_message_id_inbox_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "inbox_messages"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_ledger_person_idx" ON "consent_ledger" ("person_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_ledger_ws_person_idx" ON "consent_ledger" ("workspace_id", "person_record_id");
--> statement-breakpoint

-- ── 7) Conversation rollups (derived, rebuildable) ───────────────────────────
CREATE TABLE IF NOT EXISTS "conversation_rollups" (
  "deal_record_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "summary" text NOT NULL,
  "covers_through_message_id" text,
  "covers_through_at" timestamp,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_rollups_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE CASCADE,
  CONSTRAINT "conversation_rollups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_rollups_ws_idx" ON "conversation_rollups" ("workspace_id");
--> statement-breakpoint

-- ── 8) Playbooks, variants, eval harness ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_playbooks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "operating_company_record_id" text,
  "version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "title" text,
  "content" jsonb NOT NULL,
  "activated_at" timestamp,
  "activated_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "agent_playbooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_playbooks_operating_company_record_id_records_id_fk" FOREIGN KEY ("operating_company_record_id") REFERENCES "records"("id") ON DELETE SET NULL,
  CONSTRAINT "agent_playbooks_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_playbooks_ws_idx" ON "agent_playbooks" ("workspace_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_playbooks_ws_oc_version_idx" ON "agent_playbooks" ("workspace_id", "operating_company_record_id", "version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_variants" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "operating_company_record_id" text,
  "message_class" text NOT NULL,
  "variant_key" text NOT NULL,
  "content" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "message_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "message_variants_operating_company_record_id_records_id_fk" FOREIGN KEY ("operating_company_record_id") REFERENCES "records"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_variants_ws_class_key_idx" ON "message_variants" ("workspace_id", "message_class", "variant_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "variant_stats" (
  "variant_id" text NOT NULL,
  "date" date NOT NULL,
  "sends" integer NOT NULL DEFAULT 0,
  "replies" integer NOT NULL DEFAULT 0,
  "conversions" integer NOT NULL DEFAULT 0,
  CONSTRAINT "variant_stats_variant_id_date_pk" PRIMARY KEY ("variant_id", "date"),
  CONSTRAINT "variant_stats_variant_id_message_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "message_variants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_cases" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "kind" text NOT NULL,
  "deal_record_id" text,
  "conversation_id" text,
  "input" jsonb NOT NULL,
  "expected" jsonb NOT NULL,
  "notes" text,
  "frozen" boolean NOT NULL DEFAULT false,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "eval_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "eval_cases_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "records"("id") ON DELETE SET NULL,
  CONSTRAINT "eval_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_cases_ws_kind_idx" ON "eval_cases" ("workspace_id", "kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "suite" text NOT NULL,
  "git_ref" text,
  "prompt_version" text,
  "playbook_version" text,
  "total_cases" integer NOT NULL DEFAULT 0,
  "passed" integer NOT NULL DEFAULT 0,
  "failed" integer NOT NULL DEFAULT 0,
  "results" jsonb,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_runs_ws_created_idx" ON "eval_runs" ("workspace_id", "created_at");
--> statement-breakpoint

-- ── 9) Per-brand agent profile on portal settings ────────────────────────────
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "agent_signature" text;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "agent_tone_rules" text;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "agent_facts_sheet" jsonb;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "agent_forbidden_terms" jsonb;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "agent_deflection_templates" jsonb;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "agent_opt_out_line" text;
--> statement-breakpoint

-- ── 10) Voice-note transcripts (decided 2026-07-22: transcribe at ingest) ────
ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "transcript" text;
--> statement-breakpoint
ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "transcribed_at" timestamp;
--> statement-breakpoint
-- Transcription worker hot query: inbound audio without a transcript yet.
CREATE INDEX IF NOT EXISTS "inbox_attachments_untranscribed_idx"
  ON "inbox_message_attachments" ("created_at")
  WHERE "mime_type" LIKE 'audio/%' AND "transcribed_at" IS NULL;
