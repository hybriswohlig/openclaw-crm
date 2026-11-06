-- Kalkulationsseite: Street-View-Bilder je Adresse und Route je Version.
-- Idempotent: ein zweiter Lauf ändert nichts. Reine Anzeige-Daten, kein
-- Backfill. Bild und Route gelten höchstens 30 Tage (geholt_am/berechnet_am),
-- danach holt der Dienst neu; dauerhaft bleibt nur pano_id.

CREATE TABLE IF NOT EXISTS "street_view_images" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "adresse_schluessel" text NOT NULL,
  "adresse" text NOT NULL,
  "status" text NOT NULL,
  "blob_pfad" text,
  "pano_id" text,
  "geholt_am" timestamptz NOT NULL,
  "notiz" text,
  "notiz_von" text REFERENCES "users"("id") ON DELETE SET NULL,
  "notiz_am" timestamptz,
  CONSTRAINT "street_view_images_status_check" CHECK ("status" in ('ok', 'kein_bild', 'fehler'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "street_view_images_ws_adresse_unique" ON "street_view_images" ("workspace_id", "adresse_schluessel");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_calculation_routes" (
  "calculation_version_id" text PRIMARY KEY REFERENCES "deal_calculation_versions"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL,
  "punkte_schluessel" text NOT NULL,
  "teilstrecken" jsonb NOT NULL,
  "google_link" text NOT NULL,
  "berechnet_am" timestamptz NOT NULL
);
