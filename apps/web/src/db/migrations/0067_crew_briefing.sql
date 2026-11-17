-- Crew-Portal Phase 2: Briefing je Job. Von Hand, idempotent und nur additiv.
-- Läuft nach 0066 (crew_links, crew_job_responses).

-- ─── Freigabe ───────────────────────────────────────────────────────────────
-- Eine Zeile je Deal = das Briefing ist für das eingeteilte Team freigegeben.
-- „Erneut freigeben“ setzt released_at neu, „Zurückziehen“ setzt withdrawn_at.
CREATE TABLE IF NOT EXISTS "crew_briefings" (
  "deal_record_id" text PRIMARY KEY REFERENCES "records"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "released_at" timestamptz NOT NULL DEFAULT now(),
  "released_by" text,
  "withdrawn_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_briefings_workspace_idx" ON "crew_briefings" ("workspace_id");
--> statement-breakpoint

-- ─── Gelesen ────────────────────────────────────────────────────────────────
-- Gilt für die Freigabe, zu der gelesen wurde (released_at): nach „Erneut
-- freigeben“ ist es für alle wieder neu, ohne dass etwas gelöscht wird.
CREATE TABLE IF NOT EXISTS "crew_briefing_reads" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "release_at" timestamptz NOT NULL,
  "read_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crew_briefing_reads_uq" ON "crew_briefing_reads" ("deal_record_id", "employee_id", "release_at");
--> statement-breakpoint

-- ─── Versand per WhatsApp ───────────────────────────────────────────────────
-- Jeder Versuch wird festgehalten, auch übersprungene (kein Telefon, kein Link),
-- damit im Einsatz-Dialog steht, wer die Nachricht bekommen hat.
CREATE TABLE IF NOT EXISTS "crew_notifications" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_notifications_deal_idx" ON "crew_notifications" ("deal_record_id", "employee_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_notifications_kind_check' AND conrelid = '"crew_notifications"'::regclass) THEN
    ALTER TABLE "crew_notifications" ADD CONSTRAINT "crew_notifications_kind_check" CHECK ("kind" IN ('briefing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_notifications_status_check' AND conrelid = '"crew_notifications"'::regclass) THEN
    ALTER TABLE "crew_notifications" ADD CONSTRAINT "crew_notifications_status_check"
      CHECK ("status" IN ('gesendet', 'fehler', 'kein_telefon', 'kein_link', 'kein_absender'));
  END IF;
END $$;
