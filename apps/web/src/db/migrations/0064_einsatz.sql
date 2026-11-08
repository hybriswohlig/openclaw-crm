-- Plan 12: Einsatz und Kapazität (12a Personen und Team, 12b Transporter-Buchung,
-- 12c Kartenpunkte). Von Hand, idempotent: ein zweiter Lauf ändert nichts.
-- Läuft nach 0062 (Plan 9) und 0063 (Plan 11), braucht keine ihrer Tabellen.

-- ─── 12a: Stammdaten der Mitarbeiter ────────────────────────────────────────
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "home_plz" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "home_town" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "can_drive_sprinter" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "own_car" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "rate_drive_cents" integer NOT NULL DEFAULT 1500;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "rate_work_cents" integer;
--> statement-breakpoint
-- Eine Wahrheit für den Satz (E8): Bestand übernimmt den alten Stundensatz genau.
UPDATE "employees" SET "rate_work_cents" = round("hourly_rate" * 100) WHERE "rate_work_cents" IS NULL;
--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "rate_work_cents" SET DEFAULT 2000;
--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "rate_work_cents" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_home_plz_format' AND conrelid = '"employees"'::regclass) THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_home_plz_format"
      CHECK ("home_plz" IS NULL OR "home_plz" ~ '^[0-9]{5}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_satz_abgeleitet' AND conrelid = '"employees"'::regclass) THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_satz_abgeleitet"
      CHECK ("hourly_rate" = "rate_work_cents" / 100.0);
  END IF;
END $$;
--> statement-breakpoint

-- ─── 12a: Zuteilung mit Planminuten und Bestätigung ─────────────────────────
ALTER TABLE "deal_employees" ADD COLUMN IF NOT EXISTS "planned_drive_minutes" integer;
--> statement-breakpoint
ALTER TABLE "deal_employees" ADD COLUMN IF NOT EXISTS "planned_work_minutes" integer;
--> statement-breakpoint
ALTER TABLE "deal_employees" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "deal_employees" ADD COLUMN IF NOT EXISTS "confirmed_by" text;
--> statement-breakpoint
-- Dubletten je Paar (Deal, Person) auflösen: die älteste Zeile bleibt und wird
-- lead, wenn eine der Dubletten lead war; die übrigen werden gelöscht.
UPDATE "deal_employees" d SET "role" = 'lead'
FROM (
  SELECT "id",
    row_number() OVER (PARTITION BY "deal_record_id", "employee_id" ORDER BY "created_at", "id") AS rn,
    bool_or("role" = 'lead') OVER (PARTITION BY "deal_record_id", "employee_id") AS hat_lead,
    count(*) OVER (PARTITION BY "deal_record_id", "employee_id") AS anzahl
  FROM "deal_employees"
) r
WHERE d."id" = r."id" AND r.rn = 1 AND r.anzahl > 1 AND r.hat_lead AND d."role" <> 'lead';
--> statement-breakpoint
DELETE FROM "deal_employees" d
USING (
  SELECT "id", row_number() OVER (PARTITION BY "deal_record_id", "employee_id" ORDER BY "created_at", "id") AS rn
  FROM "deal_employees"
) r
WHERE d."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_employees_deal_employee_uq" ON "deal_employees" ("deal_record_id", "employee_id");
--> statement-breakpoint

-- ─── 12a: Verfügbarkeit als Ausnahme (E1) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "employee_absences" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "von" date NOT NULL,
  "bis" date NOT NULL,
  "art" text NOT NULL,
  "notiz" text,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_absences_art_check' AND conrelid = '"employee_absences"'::regclass) THEN
    ALTER TABLE "employee_absences" ADD CONSTRAINT "employee_absences_art_check"
      CHECK ("art" IN ('urlaub', 'krank', 'gesperrt'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_absences_zeitraum_check' AND conrelid = '"employee_absences"'::regclass) THEN
    ALTER TABLE "employee_absences" ADD CONSTRAINT "employee_absences_zeitraum_check" CHECK ("bis" >= "von");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_absences_workspace_zeitraum_idx" ON "employee_absences" ("workspace_id", "von", "bis");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_absences_employee_idx" ON "employee_absences" ("employee_id");
--> statement-breakpoint

-- ─── 12a: Kilometer je Ort und Adresse (I3), ohne Personen und ohne Minuten ──
CREATE TABLE IF NOT EXISTS "einsatz_wege" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "ort_schluessel" text NOT NULL,
  "adresse_schluessel" text NOT NULL,
  "km" numeric(7, 1) NOT NULL,
  "berechnet_am" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "ort_schluessel", "adresse_schluessel")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'einsatz_wege_km_check' AND conrelid = '"einsatz_wege"'::regclass) THEN
    ALTER TABLE "einsatz_wege" ADD CONSTRAINT "einsatz_wege_km_check" CHECK ("km" >= 0);
  END IF;
END $$;
--> statement-breakpoint

-- ─── 12c: Kartenpunkte je Ort, ohne Personenbezug ───────────────────────────
CREATE TABLE IF NOT EXISTS "einsatz_orte" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "ort_schluessel" text NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "berechnet_am" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "ort_schluessel")
);
--> statement-breakpoint

-- ─── 12b: Transporter-Buchung je Firma (E5) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "vehicle_bookings" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "operating_company_record_id" text NOT NULL REFERENCES "records"("id"),
  "von" date NOT NULL,
  "bis" date NOT NULL,
  "station_id" text NOT NULL,
  "station_name" text NOT NULL,
  "station_anbieter" text,
  "klasse_id" text NOT NULL,
  "klasse_name" text NOT NULL,
  "miete_cents" integer NOT NULL,
  "inklusiv_km" integer,
  "mehrkm_satz_cents" integer,
  "geplante_auftraege" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'geplant',
  "notiz" text,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_bookings_miete_check' AND conrelid = '"vehicle_bookings"'::regclass) THEN
    ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_miete_check" CHECK ("miete_cents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_bookings_auftraege_check' AND conrelid = '"vehicle_bookings"'::regclass) THEN
    ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_auftraege_check"
      CHECK ("geplante_auftraege" BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_bookings_status_check' AND conrelid = '"vehicle_bookings"'::regclass) THEN
    ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_status_check"
      CHECK ("status" IN ('geplant', 'bestaetigt', 'storniert'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_bookings_zeitraum_check' AND conrelid = '"vehicle_bookings"'::regclass) THEN
    ALTER TABLE "vehicle_bookings" ADD CONSTRAINT "vehicle_bookings_zeitraum_check" CHECK ("bis" >= "von");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_bookings_workspace_zeitraum_idx" ON "vehicle_bookings" ("workspace_id", "von", "bis");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_vehicle_bookings" (
  "deal_record_id" text PRIMARY KEY REFERENCES "records"("id") ON DELETE CASCADE,
  "booking_id" text NOT NULL REFERENCES "vehicle_bookings"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL,
  "geschaetzte_km" integer,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_vehicle_bookings_booking_idx" ON "deal_vehicle_bookings" ("booking_id");
--> statement-breakpoint
-- Die beiden Spalten aus 0057 und 0061 waren bis hier nie beschrieben. Das
-- Live-Skript zählt vorher Werte ungleich null; gibt es welche, scheitert der
-- Fremdschlüssel sichtbar statt still.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_calculation_versions_vehicle_booking_fk' AND conrelid = '"deal_calculation_versions"'::regclass) THEN
    ALTER TABLE "deal_calculation_versions" ADD CONSTRAINT "deal_calculation_versions_vehicle_booking_fk"
      FOREIGN KEY ("vehicle_booking_id") REFERENCES "vehicle_bookings"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_date_offers_vehicle_booking_fk' AND conrelid = '"quotation_date_offers"'::regclass) THEN
    ALTER TABLE "quotation_date_offers" ADD CONSTRAINT "quotation_date_offers_vehicle_booking_fk"
      FOREIGN KEY ("vehicle_booking_id") REFERENCES "vehicle_bookings"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
-- Firmen-Schalter (12b Entscheidung 8): Mietanteil im Preis, Standard aus.
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "buchung_im_preis" boolean NOT NULL DEFAULT false;
