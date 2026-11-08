-- Plan 9 „Geld“: Rechnung als Datensatz, Zahlungsquelle und Storno,
-- Zahlungsregel je Firma, bezahlt_am, Zahlungserinnerungen.
-- Idempotent und nur additiv: ein zweiter Lauf ändert nichts.

CREATE TABLE IF NOT EXISTS "deal_invoices" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL CONSTRAINT "deal_invoices_deal_record_id_records_id_fk" REFERENCES "records"("id") ON DELETE CASCADE,
  "operating_company_id" text CONSTRAINT "deal_invoices_operating_company_id_records_id_fk" REFERENCES "records"("id") ON DELETE SET NULL,
  "nummer" text,
  "jahr" integer,
  "laufnummer" integer,
  "herkunft" text NOT NULL,
  "status" text NOT NULL,
  "brutto_cent" integer,
  "rechnungstag" date,
  "faellig_am" date,
  "abweichung_grund" text,
  "deal_document_id" text CONSTRAINT "deal_invoices_deal_document_id_deal_documents_id_fk" REFERENCES "deal_documents"("id") ON DELETE SET NULL,
  "render_job_id" text,
  "storno_grund" text,
  "storniert_am" timestamptz,
  "storniert_von" text,
  "verworfen_grund" text,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deal_invoices_herkunft_check" CHECK ("herkunft" IN ('crm', 'vps', 'upload', 'alt')),
  CONSTRAINT "deal_invoices_status_check" CHECK ("status" IN ('entwurf', 'gestellt', 'storniert', 'verworfen')),
  CONSTRAINT "deal_invoices_brutto_check" CHECK ("brutto_cent" IS NULL OR "brutto_cent" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_invoices_nummer_uniq"
  ON "deal_invoices" ("workspace_id", "operating_company_id", "nummer") WHERE "nummer" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_invoices_aktiv_uniq"
  ON "deal_invoices" ("deal_record_id") WHERE "status" IN ('entwurf', 'gestellt');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_invoices_dokument_uniq"
  ON "deal_invoices" ("deal_document_id") WHERE "deal_document_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_invoices_status_idx"
  ON "deal_invoices" ("workspace_id", "status", "faellig_am");
--> statement-breakpoint
-- Altbestand: je Deal die neueste Rechnung als gestellt, ohne Nummer und Betrag.
INSERT INTO "deal_invoices" (
  "id", "workspace_id", "deal_record_id", "operating_company_id", "herkunft", "status",
  "rechnungstag", "faellig_am", "deal_document_id", "created_at", "updated_at"
)
SELECT DISTINCT ON (dd."deal_record_id")
  gen_random_uuid()::text,
  dd."workspace_id",
  dd."deal_record_id",
  (SELECT rv."referenced_record_id" FROM "record_values" rv
     JOIN "attributes" a ON a."id" = rv."attribute_id"
    WHERE rv."record_id" = dd."deal_record_id" AND a."slug" = 'operating_company'
      AND rv."referenced_record_id" IS NOT NULL
    LIMIT 1),
  'alt',
  'gestellt',
  ((dd."uploaded_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')::date,
  (SELECT rv."date_value" FROM "record_values" rv
     JOIN "attributes" a ON a."id" = rv."attribute_id"
    WHERE rv."record_id" = dd."deal_record_id" AND a."slug" = 'rechnung_faellig_am'
      AND rv."date_value" IS NOT NULL
    LIMIT 1),
  dd."id",
  now(),
  now()
FROM "deal_documents" dd
WHERE dd."document_type" = 'invoice'
  AND NOT EXISTS (SELECT 1 FROM "deal_invoices" di WHERE di."deal_record_id" = dd."deal_record_id")
ORDER BY dd."deal_record_id", dd."uploaded_at" DESC, dd."id" DESC;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "quelle" text
  CONSTRAINT "payments_quelle_check" CHECK ("quelle" IS NULL OR "quelle" IN ('hand', 'meldung', 'mitarbeiter', 'api', 'storno'));
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "employee_id" text
  CONSTRAINT "payments_employee_id_employees_id_fk" REFERENCES "employees"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bar_erhalten_am" timestamptz;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bar_erhalten_von" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storno_von_payment_id" text
  CONSTRAINT "payments_storno_von_payment_id_payments_id_fk" REFERENCES "payments"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storno_grund" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_storno_von_uniq"
  ON "payments" ("storno_von_payment_id") WHERE "storno_von_payment_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "zahlungsziel_basis" text NOT NULL DEFAULT 'umzugstag'
  CONSTRAINT "company_settings_zahlungsziel_basis_check" CHECK ("zahlungsziel_basis" IN ('umzugstag', 'rechnungstag'));
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "zahlungsziel_tage" integer NOT NULL DEFAULT 0
  CONSTRAINT "company_settings_zahlungsziel_tage_check" CHECK ("zahlungsziel_tage" BETWEEN 0 AND 60);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "erinnerung_modus" text NOT NULL DEFAULT 'aus'
  CONSTRAINT "company_settings_erinnerung_modus_check" CHECK ("erinnerung_modus" IN ('aus', 'entwurf'));
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "erinnerung_tage" integer NOT NULL DEFAULT 7
  CONSTRAINT "company_settings_erinnerung_tage_check" CHECK ("erinnerung_tage" BETWEEN 1 AND 60);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "erinnerung2_tage" integer NOT NULL DEFAULT 14
  CONSTRAINT "company_settings_erinnerung2_tage_check" CHECK ("erinnerung2_tage" BETWEEN 1 AND 60);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "steuernummer" text;
--> statement-breakpoint
ALTER TABLE "deal_workflow_state" ADD COLUMN IF NOT EXISTS "bezahlt_am" timestamptz;
--> statement-breakpoint
ALTER TABLE "document_render_jobs" ADD COLUMN IF NOT EXISTS "invoice_id" text
  CONSTRAINT "document_render_jobs_invoice_id_deal_invoices_id_fk" REFERENCES "deal_invoices"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_reminders" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL CONSTRAINT "payment_reminders_deal_record_id_records_id_fk" REFERENCES "records"("id") ON DELETE CASCADE,
  "invoice_id" text NOT NULL CONSTRAINT "payment_reminders_invoice_id_deal_invoices_id_fk" REFERENCES "deal_invoices"("id") ON DELETE CASCADE,
  "stufe" smallint NOT NULL,
  "faellig_am" date NOT NULL,
  "rest_cent" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'entwurf',
  "kanal" text,
  "draft_id" text,
  "stopp_grund" text,
  "gesendet_am" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payment_reminders_stufe_check" CHECK ("stufe" IN (1, 2)),
  CONSTRAINT "payment_reminders_status_check" CHECK ("status" IN ('entwurf', 'gesendet', 'verworfen', 'gestoppt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reminders_stufe_uniq" ON "payment_reminders" ("invoice_id", "stufe");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_reminders_deal_idx" ON "payment_reminders" ("workspace_id", "deal_record_id");
