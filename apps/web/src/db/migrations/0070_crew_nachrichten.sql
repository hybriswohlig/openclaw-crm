-- Crew-Portal: WhatsApp an die Crew bei Zusage („Du bist dabei“) und einmal am
-- Tag zu neuen Jobs. crew_notifications bekommt die neuen Arten; release_at
-- gilt nur fürs Briefing und darf sonst leer sein. Welche Jobs wem schon
-- angekündigt wurden, steht in crew_job_announcements (nie doppelt).
-- Von Hand, idempotent; lockert nur Bedingungen, löscht keine Daten. Läuft nach 0069.
ALTER TABLE "crew_notifications" ALTER COLUMN "release_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "crew_notifications" DROP CONSTRAINT IF EXISTS "crew_notifications_kind_check";
--> statement-breakpoint
ALTER TABLE "crew_notifications" ADD CONSTRAINT "crew_notifications_kind_check" CHECK ("kind" IN ('briefing', 'zusage', 'neue_jobs'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crew_job_announcements" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "announced_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crew_job_announcements_uq" ON "crew_job_announcements" ("deal_record_id", "employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_job_announcements_employee_idx" ON "crew_job_announcements" ("employee_id");
