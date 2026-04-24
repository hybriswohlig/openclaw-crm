import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot migration for the cross-company balancing feature.
 *
 * Adds:
 *   1. payment_method enum (cash/bank_transfer/other)
 *   2. private_transaction_direction enum (einlage/entnahme)
 *   3. expenses.is_tax_deductible, expenses.paying_operating_company_id
 *   4. employee_transactions.is_tax_deductible, .paying_operating_company_id, .payment_method
 *   5. private_transactions table (standalone partner-level money movements)
 *
 * Idempotent — all DDL uses IF NOT EXISTS / DO $$ guards.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString);

  console.log("Creating enums…");
  await sql`
    DO $$ BEGIN
      CREATE TYPE payment_method AS ENUM ('cash', 'bank_transfer', 'other');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE private_transaction_direction AS ENUM ('einlage', 'entnahme');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;

  console.log("Extending expenses…");
  await sql`
    ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS is_tax_deductible boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS paying_operating_company_id text
        REFERENCES records(id) ON DELETE SET NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS expenses_paying_company_idx ON expenses (paying_operating_company_id)`;

  console.log("Extending employee_transactions…");
  await sql`
    ALTER TABLE employee_transactions
      ADD COLUMN IF NOT EXISTS is_tax_deductible boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS paying_operating_company_id text
        REFERENCES records(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS payment_method payment_method
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS employee_transactions_paying_company_idx
      ON employee_transactions (paying_operating_company_id)
  `;

  console.log("Creating private_transactions table…");
  await sql`
    CREATE TABLE IF NOT EXISTS private_transactions (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      date date NOT NULL,
      amount numeric(14, 2) NOT NULL,
      method payment_method NOT NULL DEFAULT 'cash',
      from_partner text NOT NULL,
      to_partner text,
      operating_company_id text NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
      direction private_transaction_direction NOT NULL,
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS private_transactions_workspace_idx ON private_transactions (workspace_id)`;
  await sql`CREATE INDEX IF NOT EXISTS private_transactions_date_idx ON private_transactions (date)`;
  await sql`CREATE INDEX IF NOT EXISTS private_transactions_company_idx ON private_transactions (operating_company_id)`;

  console.log("✓ Done.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
