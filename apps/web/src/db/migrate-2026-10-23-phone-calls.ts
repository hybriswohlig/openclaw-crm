import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * Anrufe: eigene Tabelle, idempotent. Der alte Code liest sie nicht.
 * Reihenfolge beim Deploy: erst dieses Skript gegen die Ziel-DB, dann den Code.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-23-phone-calls.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`CREATE TABLE IF NOT EXISTS phone_calls (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    external_id text NOT NULL,
    caller_raw text,
    caller_e164 text,
    called_raw text,
    called_e164 text,
    line_label text,
    answered_by text,
    started_at timestamp NOT NULL,
    duration_seconds integer,
    transcript text,
    summary text,
    keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
    person_record_id text REFERENCES records(id) ON DELETE SET NULL,
    match_status text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT phone_calls_match_status_chk CHECK (match_status IN ('matched','unmatched','ambiguous','no_number'))
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS phone_calls_workspace_external_idx ON phone_calls (workspace_id, external_id)`;
  await sql`CREATE INDEX IF NOT EXISTS phone_calls_person_idx ON phone_calls (person_record_id)`;
  await sql`CREATE INDEX IF NOT EXISTS phone_calls_caller_idx ON phone_calls (workspace_id, caller_e164)`;
  await sql`CREATE INDEX IF NOT EXISTS phone_calls_started_idx ON phone_calls (workspace_id, started_at)`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM phone_calls`;
  console.log(`phone_calls bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
