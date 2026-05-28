-- ─── Customer-portal visit tracking ───────────────────────────────────────────
-- Granular per-session telemetry for the customer status link. The existing
-- `view_count` + `first_viewed_at` / `last_viewed_at` columns on
-- customer_status_links are a single counter and don't tell the operator how
-- long the customer actually engaged. This adds:
--   1) `customer_portal_visits` — one row per browser session (deduped by a
--      localStorage-stored sessionId), with foreground/active-ms heartbeats.
--   2) Two roll-up columns on `customer_status_links` so the operator's share
--      panel can show "5 Sitzungen · 4 Min 12 s aktiv" without a join.

CREATE TABLE IF NOT EXISTS "customer_portal_visits" (
  "id" text PRIMARY KEY NOT NULL,
  "customer_link_id" text NOT NULL REFERENCES "customer_status_links"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL,
  -- One of "share_panel" | "sms" | "whatsapp" | "email" | "unknown" — best-effort
  -- inferred from referrer + utm_source on the open beacon.
  "channel" text,
  "user_agent" text,
  "ip_address" text,
  "referrer" text,
  "is_mobile" boolean,
  -- Stage the customer landed on (1-4). Helps the operator see whether they
  -- abandoned at Stage 1 (price card) vs reviewed a finished invoice.
  "stage_at_open" smallint,
  "opened_at" timestamp NOT NULL DEFAULT NOW(),
  "last_heartbeat_at" timestamp NOT NULL DEFAULT NOW(),
  -- Foreground-active ms only — the client stops counting when the tab is
  -- hidden, so this represents real engagement, not just an open tab.
  "active_ms" integer NOT NULL DEFAULT 0,
  -- Includes idle while the tab is visible (mouse-away, scroll-pause etc.).
  -- We track both so we can sanity-check the active number.
  "page_visible_ms" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_portal_visits_session_idx"
  ON "customer_portal_visits" ("customer_link_id", "session_id");

CREATE INDEX IF NOT EXISTS "customer_portal_visits_deal_idx"
  ON "customer_portal_visits" ("deal_record_id", "opened_at" DESC);

ALTER TABLE "customer_status_links"
  ADD COLUMN IF NOT EXISTS "total_active_ms" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "session_count" integer NOT NULL DEFAULT 0;

-- ─── Multi-date offer ─────────────────────────────────────────────────────────
-- Operator can propose 2-5 candidate move dates, each with one or more time
-- slots ("vormittags 08-11", "ganztags 08-17"). The customer picks one on the
-- portal; the chosen date + slot is mirrored back to the deal's `move_date`
-- attribute so the rest of the CRM sees the agreed-upon date.

CREATE TABLE IF NOT EXISTS "quotation_date_offers" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "offer_date" date NOT NULL,
  -- jsonb array of { label, startTime, endTime } — startTime/endTime are
  -- "HH:MM" strings or null when only a label is given.
  "slots" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "is_recommended" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "quotation_date_offers_deal_idx"
  ON "quotation_date_offers" ("deal_record_id", "sort_order");

CREATE TABLE IF NOT EXISTS "customer_date_selections" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL UNIQUE REFERENCES "records"("id") ON DELETE CASCADE,
  "customer_link_id" text NOT NULL REFERENCES "customer_status_links"("id") ON DELETE CASCADE,
  "date_offer_id" text NOT NULL REFERENCES "quotation_date_offers"("id") ON DELETE CASCADE,
  "selected_date" date NOT NULL,
  -- Mirrored from the slot the customer picked. Free-text label is the
  -- human-readable form ("vormittags 08-11"), startTime/endTime are the
  -- machine times for downstream calendar integrations.
  "selected_slot_label" text,
  "selected_slot_start" text,
  "selected_slot_end" text,
  "ip_address" text,
  "user_agent" text,
  "selected_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "customer_date_selections_link_idx"
  ON "customer_date_selections" ("customer_link_id");
