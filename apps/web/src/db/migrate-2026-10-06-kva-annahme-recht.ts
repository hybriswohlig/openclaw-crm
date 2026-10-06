import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * kva_confirmations: Nachweis-Spalten für die rechtssichere Annahme und
 * „Annahme aufheben“. Idempotent. Reihenfolge beim Deploy: erst dieses
 * Skript gegen die Ziel-DB, dann den Code ausrollen (alter Code bleibt mit
 * dem neuen Schema lauffähig: neue Spalten haben Defaults bzw. sind NULL).
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-06-kva-annahme-recht.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  // Jede Anweisung ist für sich idempotent; der neue Index entsteht vor dem
  // Entfernen des alten, damit nie ein Moment ohne Eindeutigkeit entsteht.
  await sql`ALTER TABLE kva_confirmations
      ADD COLUMN IF NOT EXISTS superseded_at timestamp,
      ADD COLUMN IF NOT EXISTS superseded_by text,
      ADD COLUMN IF NOT EXISTS superseded_reason text,
      ADD COLUMN IF NOT EXISTS service_type text,
      ADD COLUMN IF NOT EXISTS widerruf_modus text,
      ADD COLUMN IF NOT EXISTS vorzeitiger_beginn_verlangt boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS haftungshinweis_bestaetigt boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS versicherung_gewuenscht boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS selected_option_id text,
      ADD COLUMN IF NOT EXISTS selected_option_name text,
      ADD COLUMN IF NOT EXISTS move_date text,
      ADD COLUMN IF NOT EXISTS from_address text,
      ADD COLUMN IF NOT EXISTS to_address text,
      ADD COLUMN IF NOT EXISTS quotation_document_id text,
      ADD COLUMN IF NOT EXISTS quotation_document_sha256 text,
      ADD COLUMN IF NOT EXISTS agb_text_sha256 text,
      ADD COLUMN IF NOT EXISTS agb_text text,
      ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamp,
      ADD COLUMN IF NOT EXISTS confirmation_channels text`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS kva_confirmations_deal_aktiv_uniq
      ON kva_confirmations (deal_record_id) WHERE superseded_at IS NULL`;
  await sql`DROP INDEX IF EXISTS kva_confirmations_deal_uniq`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM kva_confirmations`;
  console.log(`kva_confirmations bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
