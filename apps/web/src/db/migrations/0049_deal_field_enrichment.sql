-- Background KI enrichment for empty deal fields (Quelle, Anzeige, Verlustgrund, Phase).
-- Additive only. Cursors keep the input hash so unchanged threads are not sent again.
-- Suggestions remember rejections so the same evidence is not proposed twice.

CREATE TABLE IF NOT EXISTS "deal_enrichment_cursors" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "input_hash" text,
  "activity_cursor" timestamp,
  "run_after" timestamp,
  "last_run_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "deal_enrichment_cursors_deal_unique" UNIQUE ("workspace_id", "deal_record_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_enrichment_cursors_run_after_idx"
  ON "deal_enrichment_cursors" ("run_after");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_field_suggestions" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "field_slug" text NOT NULL,
  "proposed_value" text NOT NULL,
  "proposed_label" text NOT NULL,
  "confidence" numeric(4, 3) NOT NULL,
  "reason" text NOT NULL,
  "evidence_quote" text NOT NULL,
  "evidence_source_kind" text NOT NULL,
  "evidence_source_id" text NOT NULL,
  "evidence_key" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "decided_at" timestamp,
  "decided_by" text,
  CONSTRAINT "deal_field_suggestions_evidence_unique" UNIQUE ("deal_record_id", "evidence_key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_field_suggestions_pending_field_idx"
  ON "deal_field_suggestions" ("deal_record_id", "field_slug")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_field_suggestions_status_idx"
  ON "deal_field_suggestions" ("workspace_id", "status", "created_at");
