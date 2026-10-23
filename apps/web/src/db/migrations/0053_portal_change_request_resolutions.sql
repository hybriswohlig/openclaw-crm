-- Handled marker for portal change requests (Änderung anfragen, Terminänderung, Schaden).
-- The request text stays on activity_events. This table only records that staff handled it.
-- A migration is required before crm_resolve_deal_change_request can persist.

CREATE TABLE IF NOT EXISTS "portal_change_request_resolutions" (
  "request_event_id" text PRIMARY KEY REFERENCES "activity_events"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "handled_at" timestamp NOT NULL DEFAULT now(),
  "handled_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_change_request_resolutions_deal_idx"
  ON "portal_change_request_resolutions" ("workspace_id", "deal_record_id");
