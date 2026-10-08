import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * kva_widerrufe: Widerrufe über den Portal-Button (§ 356a BGB). Idempotent.
 * Reihenfolge beim Deploy: erst dieses Skript gegen die Ziel-DB, dann den
 * Code ausrollen. Alter Code kennt die Tabelle nicht und läuft unverändert.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-08-kva-widerrufe.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`CREATE TABLE IF NOT EXISTS kva_widerrufe (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      deal_record_id text NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      confirmation_id text NOT NULL REFERENCES kva_confirmations(id) ON DELETE CASCADE,
      name text NOT NULL,
      vertrag text NOT NULL,
      kanal text NOT NULL,
      email text,
      eingegangen_at timestamp NOT NULL DEFAULT now(),
      ip_address text NOT NULL,
      user_agent text NOT NULL,
      bestaetigung_sent_at timestamp,
      bestaetigung_kanaele text
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS kva_widerrufe_confirmation_uniq
      ON kva_widerrufe (confirmation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS kva_widerrufe_deal_idx
      ON kva_widerrufe (deal_record_id)`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM kva_widerrufe`;
  console.log(`kva_widerrufe bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
