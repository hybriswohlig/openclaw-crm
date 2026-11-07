-- Plan 5a: Kottke-KV mit Versionsbezug und Annahme mit Version.
-- Idempotent: ein zweiter Lauf ändert nichts. Kein Backfill; alte
-- Annahmen behalten calculation_version_id = NULL und bleiben gültig.

CREATE TABLE IF NOT EXISTS "document_render_jobs" (
  "vps_job_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "calculation_version_id" text REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL,
  "price_cents" integer,
  "status" text NOT NULL DEFAULT 'laeuft',
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "claimed_at" timestamptz,
  "stored_at" timestamptz,
  "deal_document_id" text REFERENCES "deal_documents"("id") ON DELETE SET NULL,
  "fehler" text,
  CONSTRAINT "document_render_jobs_status_check" CHECK ("status" in ('laeuft', 'abgelegt', 'verworfen', 'fehler'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_render_jobs_status_idx" ON "document_render_jobs" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_render_jobs_deal_idx" ON "document_render_jobs" ("workspace_id", "deal_record_id");
--> statement-breakpoint
ALTER TABLE "kva_confirmations" ADD COLUMN IF NOT EXISTS "calculation_version_id" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kva_confirmations_calculation_version_fk') THEN
    ALTER TABLE "kva_confirmations"
      ADD CONSTRAINT "kva_confirmations_calculation_version_fk"
      FOREIGN KEY ("calculation_version_id") REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL;
  END IF;
END $$;
