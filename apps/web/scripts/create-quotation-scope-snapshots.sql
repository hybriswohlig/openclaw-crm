-- Activation step for the post-quote scope-change guard.
-- Idempotent: creates the quotation_scope_snapshots table if it does not exist.
-- (This repo deploys schema via `pnpm db:push` / the admin DB UI, not migration
--  files — the migration journal is intentionally not the source of truth.)
--
-- After running this, also run `pnpm db:sync-objects` (or the admin UI seed) to
-- add the new deal attributes: scope_changed_after_quote, scope_change_flagged_at,
-- scope_change_tier, pending_inventory_notes, pending_volume_cbm.

CREATE TABLE IF NOT EXISTS "quotation_scope_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE cascade,
  "captured_at" timestamp DEFAULT now() NOT NULL,
  "captured_reason" text DEFAULT 'issue' NOT NULL,
  "quoted_total_cents" integer,
  "scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "quotation_scope_snapshots_deal_idx"
  ON "quotation_scope_snapshots" ("deal_record_id");
