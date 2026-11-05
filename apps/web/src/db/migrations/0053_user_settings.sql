-- Nutzer-Einstellungen: Umschaltung alte/neue Oberfläche und gespeicherte Ansichten.
-- Idempotent. Eine Zeile pro Nutzer. Ohne Zeile gilt die alte Oberfläche.

CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "ui_version" text NOT NULL DEFAULT 'alt',
  "ansichten" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "user_settings"
    ADD CONSTRAINT "user_settings_ui_version_check"
    CHECK ("ui_version" IN ('alt', 'neu'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
