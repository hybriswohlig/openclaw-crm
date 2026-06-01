import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot migration: introduce the unified `employee_ledger`.
 *
 * 1. Creates the employee_ledger_kind enum + employee_ledger table.
 * 2. Backfills from the legacy `employee_transactions`:
 *      - Every legacy row → an `earning` (or `reimbursement`) credit, reusing
 *        the SAME id so existing receipt links keep working. operating_company_id
 *        is derived from the deal's `operating_company` attribute.
 *      - Every legacy row with amount_paid > 0 → an additional `payment` debit
 *        (id = "<legacy-id>:pay") so the running balance equals the old
 *        outstanding amount.
 *
 * The legacy `employee_transactions` table is left untouched (frozen backup).
 *
 * Fully idempotent: enum/table guarded with IF NOT EXISTS, backfill uses
 * ON CONFLICT (id) DO NOTHING so re-runs are no-ops.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { ssl: "require" });

  console.log("Creating employee_ledger_kind enum…");
  await sql`
    DO $$ BEGIN
      CREATE TYPE employee_ledger_kind AS ENUM ('earning', 'reimbursement', 'payment');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;

  console.log("Creating employee_ledger table…");
  await sql`
    CREATE TABLE IF NOT EXISTS employee_ledger (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
      date date NOT NULL,
      kind employee_ledger_kind NOT NULL,
      amount numeric(14, 2) NOT NULL,
      operating_company_id text REFERENCES records(id) ON DELETE SET NULL,
      paying_operating_company_id text REFERENCES records(id) ON DELETE SET NULL,
      deal_record_id text REFERENCES records(id) ON DELETE SET NULL,
      payment_method text,
      description text,
      notes text,
      is_tax_deductible boolean NOT NULL DEFAULT true,
      due_date date,
      receipt_file text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;

  console.log("Creating indexes…");
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_workspace_idx ON employee_ledger (workspace_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_employee_idx ON employee_ledger (employee_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_deal_idx ON employee_ledger (deal_record_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_company_idx ON employee_ledger (operating_company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_paying_company_idx ON employee_ledger (paying_operating_company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_kind_idx ON employee_ledger (kind)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_ledger_date_idx ON employee_ledger (date)`;

  // ── Backfill earnings / reimbursements (reuse legacy id) ───────────────────
  // operating_company_id is resolved from the deal's `operating_company`
  // reference attribute (object slug 'deals', attribute slug 'operating_company').
  console.log("Backfilling earnings / reimbursements…");
  const earningResult = await sql`
    INSERT INTO employee_ledger (
      id, workspace_id, employee_id, date, kind, amount,
      operating_company_id, paying_operating_company_id, deal_record_id,
      payment_method, description, notes, is_tax_deductible, due_date,
      receipt_file, created_at, updated_at
    )
    SELECT
      et.id,
      et.workspace_id,
      et.employee_id,
      et.date,
      (CASE WHEN et.type = 'reimbursement' THEN 'reimbursement' ELSE 'earning' END)::employee_ledger_kind,
      et.amount,
      (
        SELECT rv.referenced_record_id
        FROM record_values rv
        JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'operating_company'
        JOIN objects o ON o.id = a.object_id AND o.slug = 'deals'
        WHERE rv.record_id = et.deal_record_id
          AND rv.referenced_record_id IS NOT NULL
        LIMIT 1
      ),
      et.paying_operating_company_id,
      et.deal_record_id,
      et.payment_method::text,
      et.description,
      et.notes,
      et.is_tax_deductible,
      et.due_date,
      et.receipt_file,
      et.created_at,
      et.updated_at
    FROM employee_transactions et
    ON CONFLICT (id) DO NOTHING
  `;
  console.log(`  inserted ${earningResult.count} credit rows`);

  // ── Backfill payments (id = legacy-id + ':pay') ────────────────────────────
  // The payment belongs to the company that bore the cost: paying company if
  // set, otherwise the deal's operating company. Cash from the same company,
  // so paying_operating_company_id = operating_company_id (no extra cross at
  // payment time; the cross was already recorded on the earning).
  console.log("Backfilling payments from amount_paid…");
  const paymentResult = await sql`
    INSERT INTO employee_ledger (
      id, workspace_id, employee_id, date, kind, amount,
      operating_company_id, paying_operating_company_id, deal_record_id,
      payment_method, description, notes, is_tax_deductible, due_date,
      receipt_file, created_at, updated_at
    )
    SELECT
      et.id || ':pay',
      et.workspace_id,
      et.employee_id,
      et.date,
      'payment'::employee_ledger_kind,
      et.amount_paid,
      COALESCE(
        et.paying_operating_company_id,
        (
          SELECT rv.referenced_record_id
          FROM record_values rv
          JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'operating_company'
          JOIN objects o ON o.id = a.object_id AND o.slug = 'deals'
          WHERE rv.record_id = et.deal_record_id
            AND rv.referenced_record_id IS NOT NULL
          LIMIT 1
        )
      ),
      COALESCE(
        et.paying_operating_company_id,
        (
          SELECT rv.referenced_record_id
          FROM record_values rv
          JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'operating_company'
          JOIN objects o ON o.id = a.object_id AND o.slug = 'deals'
          WHERE rv.record_id = et.deal_record_id
            AND rv.referenced_record_id IS NOT NULL
          LIMIT 1
        )
      ),
      et.deal_record_id,
      et.payment_method::text,
      'Altbestand: bereits gezahlt',
      NULL,
      et.is_tax_deductible,
      NULL,
      NULL,
      et.updated_at,
      et.updated_at
    FROM employee_transactions et
    WHERE et.amount_paid IS NOT NULL AND et.amount_paid::numeric > 0
    ON CONFLICT (id) DO NOTHING
  `;
  console.log(`  inserted ${paymentResult.count} payment rows`);

  console.log("✓ Done.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
