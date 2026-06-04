import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot migration: add the `in_kind` value to `employee_ledger_kind`.
 *
 * `in_kind` = Sachbezug / geldwerte Leistung: the employer buys the employee
 * something (tools, shoes, material) and offsets it against the wage. It is a
 * DEBIT, like a payment, but paid in goods instead of cash → it lowers the
 * Saldo. No existing rows are touched.
 *
 * Fully idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Must run
 * BEFORE the application code that writes `in_kind` is deployed, because the
 * enum value has to exist in the database first.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { ssl: "require" });

  console.log("Adding 'in_kind' to employee_ledger_kind enum…");
  // ADD VALUE cannot run inside a transaction block; postgres-js sends each
  // tagged statement on its own, so this is safe.
  await sql`ALTER TYPE employee_ledger_kind ADD VALUE IF NOT EXISTS 'in_kind'`;

  const values = await sql`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = 'employee_ledger_kind'::regtype
    ORDER BY enumsortorder
  `;
  console.log(
    "✓ Done. employee_ledger_kind =",
    values.map((v) => v.enumlabel).join(", ")
  );
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
