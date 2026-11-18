-- Crew-Portal: Ansprechpartner je Job (wen das Team bei Fragen anruft). Ohne
-- Zeile gilt der Standard aus workspace_settings (`crew_ansprechpartner`).
-- Von Hand, idempotent und nur additiv. Läuft nach 0068.
CREATE TABLE IF NOT EXISTS "crew_ansprechpartner" (
  "deal_record_id" text PRIMARY KEY REFERENCES "records"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "set_at" timestamptz NOT NULL DEFAULT now(),
  "set_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_ansprechpartner_workspace_idx" ON "crew_ansprechpartner" ("workspace_id");
