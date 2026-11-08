-- Plan 11 „Bewertungen und Kunden“: Modus je Firma, Token-Zustand,
-- Vormerkungen. Idempotent und nur additiv: ein zweiter Lauf ändert nichts.

ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "bewertung_modus" text NOT NULL DEFAULT 'aus'
  CONSTRAINT "company_settings_bewertung_modus_check" CHECK ("bewertung_modus" IN ('aus', 'entwurf', 'senden'));
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "bewertung_modus_seit" timestamptz;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "bewertung_haken_portal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "review_tokens" ADD COLUMN IF NOT EXISTS "zustand" text NOT NULL DEFAULT 'anspruch'
  CONSTRAINT "review_tokens_zustand_check" CHECK ("zustand" IN ('anspruch', 'gesendet', 'unklar'));
--> statement-breakpoint
ALTER TABLE "review_tokens" ADD COLUMN IF NOT EXISTS "zustand_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "review_tokens" ADD COLUMN IF NOT EXISTS "quelle" text
  CONSTRAINT "review_tokens_quelle_check" CHECK ("quelle" IS NULL OR "quelle" IN ('hand', 'vorgemerkt', 'automatik', 'alt'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_tokens_zustand_idx" ON "review_tokens" ("workspace_id", "zustand");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_tokens_klickdaten_idx" ON "review_tokens" ("clicked_at")
  WHERE "click_ip" IS NOT NULL OR "click_user_agent" IS NOT NULL;
--> statement-breakpoint
-- Altbestand (nur Token ohne Quelle): mit Klick oder passendem Versandereignis
-- gesendet, sonst unklar. Passend heißt wie klickKanal: Ereignis mit diesem
-- Token im meta, sonst ein Versandereignis desselben Deals ohne Token im meta
-- bis eine Minute nach Anlage des Tokens.
UPDATE "review_tokens" t
SET
  "zustand" = CASE
    WHEN t."clicked_at" IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM "review_events" e
        WHERE e."workspace_id" = t."workspace_id"
          AND e."deal_record_id" = t."deal_record_id"
          AND e."event_type" IN ('sent_sms', 'sent_whatsapp')
          AND e."meta"->>'token' = t."token"
      )
      OR EXISTS (
        SELECT 1 FROM "review_events" e
        WHERE e."workspace_id" = t."workspace_id"
          AND e."deal_record_id" = t."deal_record_id"
          AND e."event_type" IN ('sent_sms', 'sent_whatsapp')
          AND NOT (e."meta" ? 'token')
          AND e."at" <= t."created_at" + interval '1 minute'
      )
    THEN 'gesendet'
    ELSE 'unklar'
  END,
  "quelle" = 'alt',
  "zustand_at" = now()
WHERE t."quelle" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_vormerkungen" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL CONSTRAINT "review_vormerkungen_workspace_id_workspaces_id_fk" REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL CONSTRAINT "review_vormerkungen_deal_record_id_records_id_fk" REFERENCES "records"("id") ON DELETE CASCADE,
  "operating_company_record_id" text,
  "art" text NOT NULL,
  "status" text NOT NULL DEFAULT 'offen',
  "faellig_ab" timestamptz NOT NULL,
  "frist_bis" timestamptz NOT NULL,
  "text" text,
  "einwilligung" text,
  "erstellt_von" text,
  "sperre" text,
  "versuche" integer NOT NULL DEFAULT 0,
  "letzter_versuch_at" timestamptz,
  "erledigt_at" timestamptz,
  "erledigt_von" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "review_vormerkungen_art_check" CHECK ("art" IN ('hand', 'entwurf', 'auto')),
  CONSTRAINT "review_vormerkungen_status_check" CHECK ("status" IN ('offen', 'gesendet', 'verworfen', 'gesperrt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_vormerkungen_offen_uniq"
  ON "review_vormerkungen" ("workspace_id", "deal_record_id") WHERE "status" = 'offen';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_vormerkungen_faellig_idx"
  ON "review_vormerkungen" ("status", "faellig_ab");
