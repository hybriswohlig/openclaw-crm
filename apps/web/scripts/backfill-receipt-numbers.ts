/**
 * Phase 2 Belegnummern backfill. DRY-RUN by default — pass --apply to mutate.
 *
 * Assigns fortlaufende Belegnummern (e.g. "K-E-2026-0001") to every existing
 * numbered-eligible booking that lacks one:
 *   - expenses with taxTreatment "voll" or "teilweise"  → A-Nummern
 *   - payments with taxTreatment "betriebseinnahme"     → E-Nummern
 *
 * Rows are processed chronologically (date, then createdAt) per workspace so
 * the numbers follow the booking order. Company resolution mirrors the
 * overview: operating_company_id snapshot first, then the deal's live
 * operating company. Rows without a resolvable company get no number; they
 * are skipped and listed in the output.
 *
 * Idempotent: rows that already carry a receiptNumber are never touched, and
 * numbers are never cleared or reused.
 *
 * Run dry-run:  pnpm finance:backfill-belegnummern
 * Run apply:    pnpm finance:backfill-belegnummern --apply
 */
import "./_load-env";
import { db } from "@/db";
import { workspaces, payments, expenses } from "@/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  assignReceiptNumber,
  resolveDealOperatingCompany,
} from "@/services/financial";

const APPLY = process.argv.includes("--apply");

interface SkippedRow {
  type: "income" | "expense";
  id: string;
  date: string;
  dealRecordId: string | null;
  reason: string;
}

async function main() {
  console.log(
    `\n=== Belegnummern backfill — ${APPLY ? "APPLY (mutating)" : "DRY-RUN (no changes)"} ===`
  );

  const wss = await db.select({ id: workspaces.id }).from(workspaces);
  const summary: Array<{
    workspace: string;
    kind: "income" | "expense";
    eligible: number;
    assigned: number;
    skipped: number;
  }> = [];

  for (const { id: workspaceId } of wss) {
    // Caches shared across the whole workspace run.
    const dealCompanyCache = new Map<string, string | null>();
    const initialCache = new Map<string, string | null>();

    const resolveCompany = async (row: {
      operatingCompanyId: string | null;
      dealRecordId: string | null;
    }): Promise<string | null> => {
      if (row.operatingCompanyId) return row.operatingCompanyId;
      if (!row.dealRecordId) return null;
      if (!dealCompanyCache.has(row.dealRecordId)) {
        dealCompanyCache.set(
          row.dealRecordId,
          await resolveDealOperatingCompany(workspaceId, row.dealRecordId)
        );
      }
      return dealCompanyCache.get(row.dealRecordId) ?? null;
    };

    const paymentRows = await db
      .select({
        id: payments.id,
        date: payments.date,
        operatingCompanyId: payments.operatingCompanyId,
        dealRecordId: payments.dealRecordId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.workspaceId, workspaceId),
          isNull(payments.receiptNumber),
          eq(payments.taxTreatment, "betriebseinnahme")
        )
      )
      .orderBy(asc(payments.date), asc(payments.createdAt));

    const expenseRows = await db
      .select({
        id: expenses.id,
        date: expenses.date,
        operatingCompanyId: expenses.operatingCompanyId,
        dealRecordId: expenses.dealRecordId,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.workspaceId, workspaceId),
          isNull(expenses.receiptNumber),
          inArray(expenses.taxTreatment, ["voll", "teilweise"])
        )
      )
      .orderBy(asc(expenses.date), asc(expenses.createdAt));

    if (!paymentRows.length && !expenseRows.length) continue;
    console.log(`\n── Workspace ${workspaceId} ${"─".repeat(20)}`);

    const skipped: SkippedRow[] = [];

    const processRows = async (
      kind: "income" | "expense",
      rows: typeof paymentRows
    ) => {
      let assigned = 0;
      for (const row of rows) {
        const companyId = await resolveCompany(row);
        if (!companyId) {
          skipped.push({
            type: kind,
            id: row.id,
            date: row.date,
            dealRecordId: row.dealRecordId,
            reason: "keine Gesellschaft aufloesbar",
          });
          continue;
        }
        const year = Number(row.date.slice(0, 4));
        if (APPLY) {
          // Counters bump per (company, year, kind); rows arrive in
          // chronological order, so numbers follow the booking order.
          const num = await assignReceiptNumber(
            db,
            { workspaceId, operatingCompanyId: companyId, year, kind },
            initialCache
          );
          if (!num) {
            skipped.push({
              type: kind,
              id: row.id,
              date: row.date,
              dealRecordId: row.dealRecordId,
              reason: "kein Firmenname aufloesbar",
            });
            continue;
          }
          if (kind === "income") {
            await db
              .update(payments)
              .set({ receiptNumber: num })
              .where(eq(payments.id, row.id));
          } else {
            await db
              .update(expenses)
              .set({ receiptNumber: num })
              .where(eq(expenses.id, row.id));
          }
          console.log(`  ${num}  ${row.date}  ${kind}  ${row.id}`);
        }
        assigned++;
      }
      summary.push({
        workspace: workspaceId,
        kind,
        eligible: rows.length,
        assigned,
        skipped: rows.length - assigned,
      });
    };

    await processRows("income", paymentRows);
    await processRows("expense", expenseRows);

    if (skipped.length) {
      console.log(`\n  Uebersprungen (${skipped.length} Zeilen ohne Nummer):`);
      for (const s of skipped) {
        console.log(
          `    [${s.type}] ${s.date}  ${s.id}  deal=${s.dealRecordId ?? "-"}  (${s.reason})`
        );
      }
    }
  }

  console.log(
    `\n=== Zusammenfassung (${APPLY ? "zugewiesen" : "wuerde zuweisen"}) ===`
  );
  if (summary.length) console.table(summary);
  else console.log("Keine offenen Zeilen — alles bereits nummeriert.");
  if (!APPLY) console.log("\nDry-Run. Mit --apply ausfuehren, um Nummern zu vergeben.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
