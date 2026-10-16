import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * deal_internal_photos: agent photos stored on the deal, with no conversation
 * and no inbox message. Idempotent.
 *
 * Reihenfolge beim Deploy: erst dieses Skript gegen die Ziel-DB, dann den
 * Code ausrollen. Vorher liefert POST /api/v1/deals/{id}/photos einen
 * Datenbankfehler, weil die Tabelle fehlt.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-16-deal-internal-photos.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`CREATE TABLE IF NOT EXISTS deal_internal_photos (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      deal_record_id text NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      file_size integer NOT NULL,
      file_content text NOT NULL,
      content_sha256 text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS deal_internal_photos_hash_uniq
      ON deal_internal_photos (workspace_id, deal_record_id, content_sha256)`;
  await sql`CREATE INDEX IF NOT EXISTS deal_internal_photos_deal_idx
      ON deal_internal_photos (workspace_id, deal_record_id)`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM deal_internal_photos`;
  console.log(`deal_internal_photos bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
