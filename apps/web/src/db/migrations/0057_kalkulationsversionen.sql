-- Kalkulationsversionen je Deal, Firmen-Einstellungen, Versions-Verweise.
-- Idempotent: ein zweiter Lauf ändert nichts. Kein Backfill, alte Zeilen
-- bleiben unverändert (neue Verweise NULL, neue Listen leer).
--
-- deal_calculations: bisher nur über src/db/migrate-2026-09-27-deal-calculations.ts
-- angelegt. Hier noch einmal genau so, damit eine frische DB sie hat; auf einer
-- DB, auf der sie schon existiert, passiert nichts.
--
-- deal_calculation_versions: Entwurf | gesperrt, höchstens ein Entwurf je Deal
-- (Teil-Unique deal_calculation_versions_ein_entwurf). Vollständiger Anfrage-
-- und Ergebnis-Schnappschuss des Rechners; reference_date ist das feste
-- Berliner Datum der Berechnung.

CREATE TABLE IF NOT EXISTS deal_calculations (
  deal_record_id text PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  request jsonb NOT NULL,
  result jsonb,
  error text,
  computed_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS deal_calculations_workspace_idx ON deal_calculations (workspace_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_calculation_versions" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'entwurf',
  "pricing_mode" text NOT NULL DEFAULT 'fest',
  "reference_date" date NOT NULL,
  "inputs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "overrides" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rechner_request" jsonb,
  "rechner_result" jsonb,
  "error" text,
  "cost_lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "margin" jsonb,
  "price_cents" integer,
  "package_prices" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "kv_items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tariff" jsonb,
  "vehicle_booking_id" text,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "locked_at" timestamp,
  "locked_by" text,
  "sent_at" timestamp,
  "sent_via" text
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "deal_calculation_versions"
    ADD CONSTRAINT "deal_calculation_versions_status_check"
    CHECK ("status" IN ('entwurf', 'gesperrt'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "deal_calculation_versions"
    ADD CONSTRAINT "deal_calculation_versions_pricing_mode_check"
    CHECK ("pricing_mode" IN ('fest', 'stunden'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_calculation_versions_deal_version_unique"
  ON "deal_calculation_versions" ("deal_record_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_calculation_versions_ein_entwurf"
  ON "deal_calculation_versions" ("deal_record_id")
  WHERE "status" = 'entwurf';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_calculation_versions_workspace_deal_idx"
  ON "deal_calculation_versions" ("workspace_id", "deal_record_id");
--> statement-breakpoint
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "calculation_version_id" text;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "quotations"
    ADD CONSTRAINT "quotations_calculation_version_fk"
    FOREIGN KEY ("calculation_version_id")
    REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "deal_documents"
  ADD COLUMN IF NOT EXISTS "calculation_version_id" text;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "deal_documents"
    ADD CONSTRAINT "deal_documents_calculation_version_fk"
    FOREIGN KEY ("calculation_version_id")
    REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "offer_packages"
  ADD COLUMN IF NOT EXISTS "hebel" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_settings" (
  "operating_company_record_id" text PRIMARY KEY REFERENCES "records"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL,
  "zeitposten" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rechner_marke" text,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "company_settings"
    ADD CONSTRAINT "company_settings_rechner_marke_check"
    CHECK ("rechner_marke" IN ('kottke', 'ceylan'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
