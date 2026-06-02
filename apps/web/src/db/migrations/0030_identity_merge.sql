-- ─── Identity graph, merge ledger, triage lane, soft-delete (KOT-IDENTITY) ────
-- Phase 0 foundation for the person-centric inbox + KA/WhatsApp dedup engine.
-- Everything here is ADDITIVE and reversible:
--   1) person_identifiers + person_merge_edges (new, owned by schema/identity.ts).
--   2) Additive NULLABLE columns on inbox_contacts / inbox_conversations / records.
--   3) Non-unique lookup indexes + the two partial-unique indexes that are safe
--      to create now (the new tables are empty).
-- DEFERRED to 0031 (post-backfill-dedupe): the inbox_contacts canonical UNIQUE
-- partial indexes — legacy rows collide, so the backfill must dedupe first.
-- The people 'multi_company_flag' attribute is NOT created here; it is seeded
-- via STANDARD_OBJECTS + `pnpm db:sync-objects`.

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "person_identifier_kind" AS ENUM ('phone','email','ka_relay_email','ka_pseudonym','wa_name','wa_lid');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "person_identifier_source" AS ENUM ('email','kleinanzeigen','whatsapp','sms','operator','import');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "person_identifier_trust" AS ENUM ('verified','operator','claimed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "person_merge_method" AS ENUM ('deterministic','suggested','manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "person_merge_status" AS ENUM ('suggested','applied','rejected','reverted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "conversation_lane" AS ENUM ('lead','info','spam','review');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "conversation_classified_by" AS ENUM ('header','senderlist','heuristic','llm','manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── person_identifiers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "person_identifiers" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "person_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "kind" "person_identifier_kind" NOT NULL,
  "value_raw" text NOT NULL,
  "value_canonical" text,
  "source" "person_identifier_source" NOT NULL,
  "trust" "person_identifier_trust" NOT NULL DEFAULT 'claimed',
  "first_seen" timestamp NOT NULL DEFAULT NOW(),
  "last_seen" timestamp NOT NULL DEFAULT NOW(),
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "person_identifiers_workspace_idx" ON "person_identifiers" ("workspace_id");
CREATE INDEX IF NOT EXISTS "person_identifiers_person_idx" ON "person_identifiers" ("person_record_id");
CREATE INDEX IF NOT EXISTS "person_identifiers_canonical_idx" ON "person_identifiers" ("workspace_id", "kind", "value_canonical");

-- HARD-key uniqueness, phone/email + non-null canonical only. Safe now: empty table.
CREATE UNIQUE INDEX IF NOT EXISTS "person_identifiers_hardkey_uniq"
  ON "person_identifiers" ("workspace_id", "kind", "value_canonical")
  WHERE "kind" IN ('phone','email') AND "value_canonical" IS NOT NULL;

-- ── person_merge_edges ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "person_merge_edges" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "survivor_record_id" text NOT NULL REFERENCES "records"("id"),
  "absorbed_record_id" text NOT NULL REFERENCES "records"("id"),
  "method" "person_merge_method" NOT NULL,
  "status" "person_merge_status" NOT NULL,
  "confidence" real,
  "signals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "decided_at" timestamp,
  "reverted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "person_merge_edges_workspace_idx" ON "person_merge_edges" ("workspace_id");
CREATE INDEX IF NOT EXISTS "person_merge_edges_survivor_idx" ON "person_merge_edges" ("survivor_record_id");
CREATE INDEX IF NOT EXISTS "person_merge_edges_absorbed_idx" ON "person_merge_edges" ("absorbed_record_id");
CREATE INDEX IF NOT EXISTS "person_merge_edges_status_idx" ON "person_merge_edges" ("workspace_id", "status");

-- At most one SUGGESTED row per unordered pair per workspace. applied/reverted
-- rows are exempt so a pair can be merged, split, and re-merged over time.
CREATE UNIQUE INDEX IF NOT EXISTS "person_merge_edges_suggested_pair_uniq"
  ON "person_merge_edges" ("workspace_id", "survivor_record_id", "absorbed_record_id")
  WHERE "status" = 'suggested';

-- ── inbox_contacts: canonical columns (NULLABLE) + NON-unique lookups ─────────
ALTER TABLE "inbox_contacts" ADD COLUMN IF NOT EXISTS "phone_canonical" text;
ALTER TABLE "inbox_contacts" ADD COLUMN IF NOT EXISTS "email_canonical" text;

CREATE INDEX IF NOT EXISTS "inbox_contacts_phone_canonical_idx" ON "inbox_contacts" ("workspace_id", "phone_canonical");
CREATE INDEX IF NOT EXISTS "inbox_contacts_email_canonical_idx" ON "inbox_contacts" ("workspace_id", "email_canonical");
-- NOTE: the UNIQUE partial indexes on these columns are DEFERRED to 0031,
--       AFTER migrate-2026-06-10-identity-backfill.ts dedupes colliding rows.

-- ── inbox_conversations: triage lane + D1 hold ───────────────────────────────
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "lane" "conversation_lane" NOT NULL DEFAULT 'lead';
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "classification_reason" text;
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "classified_by" "conversation_classified_by";
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "ai_hold_until" timestamp;

CREATE INDEX IF NOT EXISTS "inbox_conv_lane_idx" ON "inbox_conversations" ("workspace_id", "lane");
CREATE INDEX IF NOT EXISTS "inbox_conv_ai_hold_idx" ON "inbox_conversations" ("ai_hold_until");

-- ── records: soft-delete + loser->survivor pointer ───────────────────────────
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "merged_into_record_id" text REFERENCES "records"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "records_merged_into_idx" ON "records" ("merged_into_record_id");
CREATE INDEX IF NOT EXISTS "records_object_live_idx" ON "records" ("object_id") WHERE "deleted_at" IS NULL;
