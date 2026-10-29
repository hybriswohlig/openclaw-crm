import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * intern_rueckfragen: Rückfragen anderer Werkzeuge (Kassensturz) per WhatsApp
 * an eine interne Nummer, mit Kurzcode und Antwort. Idempotent. Nur additiv.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-23-intern-rueckfragen.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`CREATE TABLE IF NOT EXISTS intern_rueckfragen (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      quelle text NOT NULL,
      code text NOT NULL,
      frage text NOT NULL,
      optionen jsonb NOT NULL DEFAULT '[]'::jsonb,
      empfaenger text NOT NULL,
      status text NOT NULL DEFAULT 'offen',
      antwort text,
      antwort_von text,
      payload jsonb,
      expires_at timestamp NOT NULL,
      sent_at timestamp,
      answered_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS intern_rueckfragen_ws_status_idx
      ON intern_rueckfragen (workspace_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS intern_rueckfragen_quelle_idx
      ON intern_rueckfragen (workspace_id, quelle, answered_at)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS intern_rueckfragen_offen_code_idx
      ON intern_rueckfragen (workspace_id, code)
      WHERE status = 'offen'`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM intern_rueckfragen`;
  console.log(`intern_rueckfragen bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
