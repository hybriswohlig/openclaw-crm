ALTER TABLE "operating_company_portal_settings"
  ADD COLUMN IF NOT EXISTS "live_tracking_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "payments_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_document_email_requests" (
  "deal_record_id" text PRIMARY KEY REFERENCES "records"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "requested_at" timestamp NOT NULL DEFAULT now(),
  "window_started_at" timestamp NOT NULL DEFAULT now(),
  "request_count" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'sending',
  "sent_at" timestamp
);
