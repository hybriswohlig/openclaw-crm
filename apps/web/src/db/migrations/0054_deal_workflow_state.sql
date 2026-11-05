-- Wartet-Signal und Stufen-Zeitstempel je Deal.
-- Idempotent. Eine Zeile pro Deal; ohne Zeile wartet der Deal auf niemanden.

CREATE TABLE IF NOT EXISTS "deal_workflow_state" (
  "record_id" text PRIMARY KEY REFERENCES "records"("id") ON DELETE CASCADE,
  "waiting_on" text NOT NULL DEFAULT 'niemand',
  "waiting_since" timestamp,
  "waiting_reason" text,
  "last_outbound_human_at" timestamp,
  "last_inbound_at" timestamp,
  "stage_entered_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "deal_workflow_state"
    ADD CONSTRAINT "deal_workflow_state_waiting_on_check"
    CHECK ("waiting_on" IN ('uns', 'kunde', 'niemand'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
