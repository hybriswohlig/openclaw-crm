import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot ALTER: add receipt_file column on employee_transactions.
 * Stores receipt/invoice content as a base64 data URL (same pattern as
 * employees.photo_base64 and deal_documents.file_content).
 *
 * Idempotent.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString);

  console.log("Adding receipt_file to employee_transactions…");
  await sql`
    ALTER TABLE employee_transactions
      ADD COLUMN IF NOT EXISTS receipt_file text
  `;

  console.log("✓ Done.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
