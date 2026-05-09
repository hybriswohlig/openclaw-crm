import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot ALTER: add `role` (nullable text) and `status` (employee_status enum)
 * columns to `employees`. Powers the v1 team dashboard (KOT-589).
 *
 * Idempotent — safe to re-run.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString);

  console.log("Creating employee_status enum (if missing)…");
  await sql`
    DO $$ BEGIN
      CREATE TYPE "employee_status" AS ENUM ('active', 'on_leave', 'inactive');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `;

  console.log("Adding role + status columns on employees (if missing)…");
  await sql`
    ALTER TABLE "employees"
      ADD COLUMN IF NOT EXISTS "role" text
  `;
  await sql`
    ALTER TABLE "employees"
      ADD COLUMN IF NOT EXISTS "status" "employee_status" NOT NULL DEFAULT 'active'
  `;

  console.log("✓ Done.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
