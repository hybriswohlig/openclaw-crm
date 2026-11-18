-- Crew-Portal: Kundenfotos im Briefing. Standard: das bestätigte Team sieht im
-- freigegebenen Briefing alle Bildanhänge des Deals; einzelne lassen sich
-- ausblenden. Von Hand, idempotent und nur additiv. Läuft nach 0067.
ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "crew_gesperrt_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "crew_gesperrt_by" text;
