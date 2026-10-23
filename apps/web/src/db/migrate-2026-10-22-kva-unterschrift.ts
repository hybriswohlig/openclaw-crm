import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * Unterschrift im Kundenportal: Dokumenttyp signed_contract, Spalten an
 * kva_confirmations, Schalter signature_enabled je Firma. Idempotent.
 * Reihenfolge beim Deploy: erst dieses Skript gegen die Ziel-DB, dann den
 * Code ausrollen. Alter Code läuft mit dem neuen Schema unverändert (neue
 * Spalten sind NULL bzw. haben Defaults, der neue Enum-Wert wird nicht
 * gelesen).
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-22-kva-unterschrift.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  // ADD VALUE läuft nicht in einem Transaktionsblock; postgres-js schickt
  // jede Anweisung einzeln.
  await sql`ALTER TYPE deal_document_type ADD VALUE IF NOT EXISTS 'signed_contract'`;
  await sql`ALTER TABLE kva_confirmations
      ADD COLUMN IF NOT EXISTS unterschrift_at timestamp,
      ADD COLUMN IF NOT EXISTS unterschrift_name text,
      ADD COLUMN IF NOT EXISTS unterschrift_art text,
      ADD COLUMN IF NOT EXISTS unterschrift_ip text,
      ADD COLUMN IF NOT EXISTS unterschrift_user_agent text,
      ADD COLUMN IF NOT EXISTS unterschrift_bild_sha256 text,
      ADD COLUMN IF NOT EXISTS vertrag_document_id text,
      ADD COLUMN IF NOT EXISTS vertrag_sha256 text,
      ADD COLUMN IF NOT EXISTS vertrag_versand_at timestamp,
      ADD COLUMN IF NOT EXISTS vertrag_versand_kanaele text`;
  await sql`ALTER TABLE operating_company_portal_settings
      ADD COLUMN IF NOT EXISTS signature_enabled boolean NOT NULL DEFAULT false`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM kva_confirmations`;
  console.log(`kva_confirmations bereit (${anzahl} Zeilen), Unterschrift-Spalten vorhanden.`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
