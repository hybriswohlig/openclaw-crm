-- KV-Editor: Stände eines KV (Grundgerüst plus vollständige Änderungsliste) und
-- der Bezug eines VPS-Druckjobs auf seinen Stand. Vertrag: lib/kv-editor.ts.
-- Von Hand, idempotent und nur additiv: alter Code liest die neuen Spalten nicht.
-- Läuft nach 0070 (crew_nachrichten).
CREATE TABLE IF NOT EXISTS "kv_staende" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "nummer" integer NOT NULL,
  "vorgaenger_id" text REFERENCES "kv_staende"("id") ON DELETE SET NULL,
  "renderer" text NOT NULL CHECK ("renderer" IN ('vps','crm')),
  "calculation_version_id" text REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL,
  "grundlage" jsonb NOT NULL,
  "grundlage_rekonstruiert" boolean NOT NULL DEFAULT false,
  "aenderungen" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "offen" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "quelle" text NOT NULL CHECK ("quelle" IN ('neu','ausgang','hand','ki','mitgewandert')),
  "status" text NOT NULL DEFAULT 'druckt' CHECK ("status" IN ('druckt','fertig','fehler')),
  "fehler" text,
  "render_job_id" text,
  "file_name" text,
  "file_size" integer,
  "file_content" text,
  "deal_document_id" text REFERENCES "deal_documents"("id") ON DELETE SET NULL,
  "erstellt_von" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "gepusht_von" text,
  "gepusht_am" timestamptz,
  "pruefung" jsonb,
  "ki_nachricht_id" text
);
--> statement-breakpoint
-- Preisstand der Quotation beim Druck (Festpreis, Posten, Anzahlung, Paket, Stunden); Push nur bei gleichem Stand.
ALTER TABLE "kv_staende" ADD COLUMN IF NOT EXISTS "preis_stand" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kv_staende_deal_nummer_uq" ON "kv_staende" ("deal_record_id", "nummer");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kv_staende_ws_deal_idx" ON "kv_staende" ("workspace_id", "deal_record_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kv_staende_dokument_uq" ON "kv_staende" ("deal_document_id") WHERE "deal_document_id" IS NOT NULL;
--> statement-breakpoint
-- Ein KI-Vorschlag wird höchstens einmal übernommen.
CREATE UNIQUE INDEX IF NOT EXISTS "kv_staende_ki_nachricht_uq" ON "kv_staende" ("ki_nachricht_id") WHERE "ki_nachricht_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_render_jobs" ADD COLUMN IF NOT EXISTS "kv_stand_id" text;
--> statement-breakpoint
ALTER TABLE "document_render_jobs" ADD COLUMN IF NOT EXISTS "kv_stand_ziel" text;
--> statement-breakpoint
-- Ein Druckjob je Stand.
CREATE UNIQUE INDEX IF NOT EXISTS "document_render_jobs_kv_stand_uq" ON "document_render_jobs" ("kv_stand_id") WHERE "kv_stand_id" IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "document_render_jobs"
    ADD CONSTRAINT "document_render_jobs_kv_stand_fk"
    FOREIGN KEY ("kv_stand_id")
    REFERENCES "kv_staende"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "document_render_jobs"
    ADD CONSTRAINT "document_render_jobs_kv_stand_ziel_chk"
    CHECK ("kv_stand_ziel" IS NULL OR "kv_stand_ziel" IN ('entwurf','aktuell'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Ein Stand nur mit Ziel. Umgekehrt nicht erzwungen: ON DELETE SET NULL leert nur
-- `kv_stand_id`, und beim Löschen eines Workspaces fallen Stände (über workspace_id)
-- und Jobs (über den Deal) in verschiedenen Kaskaden. Ziel ohne Stand heißt: Stand
-- gelöscht, nichts ablegen.
DO $$
BEGIN
  ALTER TABLE "document_render_jobs"
    ADD CONSTRAINT "document_render_jobs_kv_stand_paar_chk"
    CHECK ("kv_stand_id" IS NULL OR "kv_stand_ziel" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
