-- Crew-Portal (Phase 1): persönlicher Link je Mitarbeiter, Antworten auf Jobs,
-- Telefon und Sprache, Foto-Freigabe für die Crew. Von Hand, idempotent: ein
-- zweiter Lauf ändert nichts. Nur additiv, nichts wird gelöscht oder umgedeutet.
-- Läuft nach 0064 (employees.active, deal_employees) und 0065.

-- ─── Mitarbeiter: Telefon, Sprache, Foto-Einwilligung ───────────────────────
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
-- E.164 (+4915112345678), aus `phone` abgeleitet; nur für Abgleich und Versand.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "phone_canonical" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'de';
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "photo_consent_at" timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_locale_check' AND conrelid = '"employees"'::regclass) THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_locale_check"
      CHECK ("locale" IN ('de', 'en', 'tr', 'ar', 'pl', 'uk', 'ru'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_phone_canonical_format' AND conrelid = '"employees"'::regclass) THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_phone_canonical_format"
      CHECK ("phone_canonical" IS NULL OR "phone_canonical" ~ '^\+[1-9][0-9]{6,14}$');
  END IF;
END $$;
--> statement-breakpoint
-- Eine Nummer gehört zu höchstens einer Person je Workspace (Zuordnung eingehender Nachrichten).
CREATE UNIQUE INDEX IF NOT EXISTS "employees_phone_canonical_uq" ON "employees" ("workspace_id", "phone_canonical") WHERE "phone_canonical" IS NOT NULL;
--> statement-breakpoint

-- ─── Persönlicher Link je Mitarbeiter ───────────────────────────────────────
-- Token im Klartext wie bei customer_status_links: das Büro kopiert den Link
-- jederzeit erneut. „Neuer Link“ setzt einen neuen Token auf dieselbe Zeile,
-- der alte führt sofort ins Leere. Sperren = revoked_at, die Zeile bleibt.
CREATE TABLE IF NOT EXISTS "crew_links" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text,
  "revoked_at" timestamptz,
  "last_seen_at" timestamptz,
  "view_count" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crew_links_employee_uq" ON "crew_links" ("employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crew_links_token_uq" ON "crew_links" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_links_workspace_idx" ON "crew_links" ("workspace_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_links_token_format' AND conrelid = '"crew_links"'::regclass) THEN
    ALTER TABLE "crew_links" ADD CONSTRAINT "crew_links_token_format" CHECK ("token" ~ '^[A-Za-z0-9_-]{32}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_links_view_count_check' AND conrelid = '"crew_links"'::regclass) THEN
    ALTER TABLE "crew_links" ADD CONSTRAINT "crew_links_view_count_check" CHECK ("view_count" >= 0);
  END IF;
END $$;
--> statement-breakpoint

-- ─── Antworten auf Jobs (Anfrage, keine Einteilung) ─────────────────────────
-- „ja“ ist eine Anfrage; eingeteilt wird nur über deal_employees (Einsatz,
-- „Team bestätigen“). Voller Job: „ja“ wird als „warteliste“ gespeichert.
CREATE TABLE IF NOT EXISTS "crew_job_responses" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "answer" text NOT NULL,
  "answered_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "source" text NOT NULL DEFAULT 'portal'
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crew_job_responses_deal_employee_uq" ON "crew_job_responses" ("deal_record_id", "employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_job_responses_workspace_deal_idx" ON "crew_job_responses" ("workspace_id", "deal_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_job_responses_employee_idx" ON "crew_job_responses" ("employee_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_job_responses_answer_check' AND conrelid = '"crew_job_responses"'::regclass) THEN
    ALTER TABLE "crew_job_responses" ADD CONSTRAINT "crew_job_responses_answer_check"
      CHECK ("answer" IN ('ja', 'vielleicht', 'nein', 'warteliste'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_job_responses_source_check' AND conrelid = '"crew_job_responses"'::regclass) THEN
    ALTER TABLE "crew_job_responses" ADD CONSTRAINT "crew_job_responses_source_check"
      CHECK ("source" IN ('portal', 'crm'));
  END IF;
END $$;
--> statement-breakpoint

-- ─── Foto-Freigabe für die Crew ─────────────────────────────────────────────
-- Kundenfotos eines Deals liegen fast alle als Bildanhang im Chat
-- (inbox_message_attachments, base64), Agenten-Fotos in deal_internal_photos,
-- Fotos vom Einsatz in job_media (Blob). Die Crew sieht nur freigegebene.
ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "crew_freigegeben_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "crew_freigegeben_by" text;
--> statement-breakpoint
ALTER TABLE "deal_internal_photos" ADD COLUMN IF NOT EXISTS "crew_freigegeben_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "deal_internal_photos" ADD COLUMN IF NOT EXISTS "crew_freigegeben_by" text;
--> statement-breakpoint
ALTER TABLE "job_media" ADD COLUMN IF NOT EXISTS "crew_freigegeben_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "job_media" ADD COLUMN IF NOT EXISTS "crew_freigegeben_by" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_attachments_crew_frei_idx" ON "inbox_message_attachments" ("deal_record_id") WHERE "crew_freigegeben_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_internal_photos_crew_frei_idx" ON "deal_internal_photos" ("deal_record_id") WHERE "crew_freigegeben_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_media_crew_frei_idx" ON "job_media" ("deal_record_id") WHERE "crew_freigegeben_at" IS NOT NULL;
