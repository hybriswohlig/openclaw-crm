-- Post-move reviews engine — schema base layer.
--
-- Adds two engine-internal tables that don't belong in the OAV record_values
-- store (high-volume audit + per-lead opaque tokens) plus a covering index
-- for the cron job's hot-path query.
--
-- Deal attributes themselves (move_completed_at, review_request_status,
-- review_request_variant, do_not_contact_review, review_contact_consent_at,
-- etc.) are seeded via STANDARD_OBJECTS + db:sync-standard-objects after
-- this migration runs. Existing-deal backfill (do_not_contact_review = true)
-- is handled by migrate-2026-05-09-reviews-engine-backfill.ts.
--
-- See KOT-614 / KOT-603 for context.

-- review_events: append-only audit trail.
CREATE TABLE IF NOT EXISTS "review_events" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL,
  "event_type" text NOT NULL,
  "variant" text,
  "channel" text,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "review_events_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "review_events_deal_record_id_fk"
    FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "review_events_deal_idx"
  ON "review_events" ("deal_record_id", "at");
CREATE INDEX IF NOT EXISTS "review_events_workspace_idx"
  ON "review_events" ("workspace_id", "at");
CREATE INDEX IF NOT EXISTS "review_events_event_type_idx"
  ON "review_events" ("workspace_id", "event_type", "at");

-- review_tokens: per-lead short-link tokens for /r/{token} redirects.
CREATE TABLE IF NOT EXISTS "review_tokens" (
  "token" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL,
  "destination_url" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "clicked_at" timestamp,
  "click_user_agent" text,
  "click_ip" text,
  CONSTRAINT "review_tokens_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "review_tokens_deal_record_id_fk"
    FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "review_tokens_deal_idx"
  ON "review_tokens" ("deal_record_id");

-- record_values index for the cron's move_completed_at scan. The existing
-- record_values_attribute_text / _number / _date / _boolean indexes cover
-- their respective typed columns; timestamp_value had no covering index,
-- which would force a sequential scan on every 15-min cron tick once
-- deal volume grows.
CREATE INDEX IF NOT EXISTS "record_values_attribute_timestamp"
  ON "record_values" ("attribute_id", "timestamp_value");
