import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * Legt die Tabelle deal_calculations an (Kalkulation je Lead aus dem
 * Umzugsgut-Angebotsrechner). Idempotent: ein zweiter Lauf ändert nichts.
 * Berührt keine andere Tabelle.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-09-27-deal-calculations.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS deal_calculations (
      deal_record_id text PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      input_hash text NOT NULL,
      request jsonb NOT NULL,
      result jsonb,
      error text,
      computed_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS deal_calculations_workspace_idx ON deal_calculations (workspace_id)`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM deal_calculations`;
  console.log(`deal_calculations bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
