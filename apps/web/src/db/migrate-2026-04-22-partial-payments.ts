import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot ALTER for partial-payment support on employee_transactions.
 * Idempotent — uses IF NOT EXISTS.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString);

  console.log("Adding amount_paid + due_date to employee_transactions…");
  await sql`
    ALTER TABLE employee_transactions
      ADD COLUMN IF NOT EXISTS amount_paid numeric(14, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS due_date date
  `;

  // Backfill: anything previously marked status='paid' gets amount_paid = amount
  // so the computed status stays correct.
  const updated = await sql`
    UPDATE employee_transactions
       SET amount_paid = amount
     WHERE status = 'paid' AND (amount_paid IS NULL OR amount_paid = 0)
  `;
  console.log(`Backfilled amount_paid on ${updated.count} previously-paid row(s).`);

  console.log("✓ Done.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
