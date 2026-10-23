import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * Anruf kann auf einen Lead zeigen. Der alte Code liest die Spalte nicht.
 * Reihenfolge beim Deploy: erst dieses Skript gegen die Ziel-DB, dann den Code.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-24-phone-calls-lead.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`ALTER TABLE phone_calls ADD COLUMN IF NOT EXISTS deal_record_id text REFERENCES records(id) ON DELETE SET NULL`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM phone_calls WHERE deal_record_id IS NOT NULL`;
  console.log(`phone_calls.deal_record_id bereit (${anzahl} verknüpft).`);
  await sql.end();
}

migrate().catch((err) => {
  const text = err instanceof Error ? err.message : "Migration fehlgeschlagen";
  console.error(text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://…"));
  process.exit(1);
});
