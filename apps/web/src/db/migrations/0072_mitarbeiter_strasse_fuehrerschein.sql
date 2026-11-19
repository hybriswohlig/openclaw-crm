-- Mitarbeiter: Straße (optional, Inhaber 19.11.: „Stadt reicht, falls wir nur
-- das haben“) und Führerscheinklasse. Beides nur für die Inhaber in
-- /api/v1/einsatz/*; nie an Portal, Crew oder MCP. Von Hand, idempotent und
-- nur additiv. Läuft nach 0071.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "home_street" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "license_class" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_license_class_check' AND conrelid = '"employees"'::regclass) THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_license_class_check"
      CHECK ("license_class" IS NULL OR "license_class" IN ('keiner', 'B', 'BE', 'C1', 'C1E', 'C', 'CE'));
  END IF;
END $$;
