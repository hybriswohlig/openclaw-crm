-- Plan 5b: Pakete, Tagespreise und Stunden-KV aus der Kalkulationsversion.
-- Idempotent und additiv: ein zweiter Lauf ändert nichts. Ohne die beiden
-- Firmen-Schalter (Standard aus) verhält sich alles wie vorher.

ALTER TABLE "deal_calculation_versions" ADD COLUMN IF NOT EXISTS "day_prices" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "price_cents" integer;
--> statement-breakpoint
ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "package_prices" jsonb;
--> statement-breakpoint
ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "calculation_version_id" text;
--> statement-breakpoint
ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "vehicle_booking_id" text;
--> statement-breakpoint
ALTER TABLE "quotation_package_options" ADD COLUMN IF NOT EXISTS "calculation_version_id" text;
--> statement-breakpoint
ALTER TABLE "kva_confirmations" ADD COLUMN IF NOT EXISTS "selected_date_offer_id" text;
--> statement-breakpoint
ALTER TABLE "kva_confirmations" ADD COLUMN IF NOT EXISTS "selected_date" date;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "angebot_aus_kalkulation" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "tagespreise_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_date_offers_calculation_version_fk') THEN
    ALTER TABLE "quotation_date_offers"
      ADD CONSTRAINT "quotation_date_offers_calculation_version_fk"
      FOREIGN KEY ("calculation_version_id") REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_package_options_calculation_version_fk') THEN
    ALTER TABLE "quotation_package_options"
      ADD CONSTRAINT "quotation_package_options_calculation_version_fk"
      FOREIGN KEY ("calculation_version_id") REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kva_confirmations_selected_date_offer_fk') THEN
    ALTER TABLE "kva_confirmations"
      ADD CONSTRAINT "kva_confirmations_selected_date_offer_fk"
      FOREIGN KEY ("selected_date_offer_id") REFERENCES "quotation_date_offers"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
-- F6: Hebel je Paket, nur wo noch keine gesetzt sind (beide Firmen gleich).
UPDATE "offer_packages" SET "hebel" = '["halteverbot", "montage"]'::jsonb
  WHERE "slug" = 'komfort' AND "hebel" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "offer_packages" SET "hebel" = '["halteverbot", "montage", "einpacken", "kueche"]'::jsonb
  WHERE "slug" = 'premium' AND "hebel" = '[]'::jsonb;
