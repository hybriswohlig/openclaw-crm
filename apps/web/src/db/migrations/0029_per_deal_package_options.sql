-- ─── Per-deal package options ─────────────────────────────────────────────────
-- The /settings/customer-portal package catalogue is a template — same names,
-- segments, included items for every deal of a firma. In practice the operator
-- wants to quote three custom price points for THIS Auftrag (small one-room
-- move vs full house etc.) so they can offer 3 take-it-or-leave-it options
-- the customer picks from. This table holds those per-deal options.
--
-- When at least one row exists for a deal, the customer's Stage 1 picker
-- shows these instead of the catalogue. When none exist, the catalogue
-- continues to be shown (current behavior is preserved).
--
-- catalogue_slug is optional: the operator can pre-fill from the catalogue
-- by slug, or compose ad-hoc options (catalogue_slug = NULL) for one-off
-- jobs that don't map cleanly to Basis/Komfort/Premium.

CREATE TABLE IF NOT EXISTS "quotation_package_options" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  -- NULL = ad-hoc option, otherwise the slug of an offer_packages row used
  -- as the seed. Stored for analytics ("offered as the Komfort tier") even
  -- after the operator edits the name / price.
  "catalogue_slug" text,
  "display_name" text NOT NULL,
  "short_description" text,
  "price_cents" integer NOT NULL,
  -- jsonb array of strings.
  "included_items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Optional one-liner shown under the price ("inkl. Einpackservice", etc.).
  "note" text,
  "is_recommended" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "quotation_package_options_deal_idx"
  ON "quotation_package_options" ("deal_record_id", "sort_order");

-- Customer's pick. ON DELETE SET NULL so that when the operator replaces the
-- option set (DELETE + INSERT pattern), any stale selection is cleared and
-- the customer is re-prompted on next portal visit.
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "selected_package_option_id" text
    REFERENCES "quotation_package_options"("id") ON DELETE SET NULL;
