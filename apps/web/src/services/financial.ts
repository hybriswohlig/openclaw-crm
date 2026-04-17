import { db } from "@/db";
import {
  dealNumberSequences,
  dealNumbers,
  payments,
  expenses,
  employeeTransactions,
  employees,
} from "@/db/schema";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { eq, and, sum, sql, gte, lt, type SQL } from "drizzle-orm";

/** Returns [startDate, endDate) strings for a "YYYY-MM" month, or null for all-time. */
function parseMonth(month: string | null): { start: string; end: string } | null {
  if (!month) return null;
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(year, m,     1)).toISOString().slice(0, 10);
  return { start, end };
}

// ─── Deal Numbers ──────────────────────────────────────────────────────────────

/**
 * Atomically assigns the next year-prefixed deal number to a newly created deal.
 * Format: "YYYY-NNN" (e.g. "2025-003"). Safe under concurrent inserts.
 */
export async function assignDealNumber(
  workspaceId: string,
  dealRecordId: string
): Promise<string> {
  const year = new Date().getFullYear();

  // Atomically increment the sequence for this workspace+year.
  const [seq] = await db
    .insert(dealNumberSequences)
    .values({ workspaceId, year, lastSequence: 1 })
    .onConflictDoUpdate({
      target: [dealNumberSequences.workspaceId, dealNumberSequences.year],
      set: {
        lastSequence: sql`${dealNumberSequences.lastSequence} + 1`,
      },
    })
    .returning({ lastSequence: dealNumberSequences.lastSequence });

  const sequence = seq.lastSequence;
  const dealNumber = `${year}-${String(sequence).padStart(3, "0")}`;

  await db.insert(dealNumbers).values({
    workspaceId,
    dealRecordId,
    year,
    sequence,
    dealNumber,
  });

  return dealNumber;
}

export async function getDealNumber(
  dealRecordId: string
): Promise<string | null> {
  const [row] = await db
    .select({ dealNumber: dealNumbers.dealNumber })
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);
  return row?.dealNumber ?? null;
}

// ─── Payments ──────────────────────────────────────────────────────────────────

export async function listPayments(dealRecordId: string) {
  return db
    .select()
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId))
    .orderBy(payments.date);
}

export async function createPayment(
  workspaceId: string,
  dealRecordId: string,
  input: {
    date: string;
    amount: string;
    payer?: string;
    paymentMethod?: string;
    reference?: string;
    notes?: string;
  }
) {
  const [row] = await db
    .insert(payments)
    .values({ workspaceId, dealRecordId, ...input })
    .returning();
  return row;
}

export async function updatePayment(
  id: string,
  workspaceId: string,
  input: Partial<{
    date: string;
    amount: string;
    payer: string;
    paymentMethod: string;
    reference: string;
    notes: string;
  }>
) {
  const [row] = await db
    .update(payments)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(payments.id, id), eq(payments.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}

export async function deletePayment(id: string, workspaceId: string) {
  const [row] = await db
    .delete(payments)
    .where(and(eq(payments.id, id), eq(payments.workspaceId, workspaceId)))
    .returning({ id: payments.id });
  return row ?? null;
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function listExpenses(dealRecordId: string) {
  return db
    .select()
    .from(expenses)
    .where(eq(expenses.dealRecordId, dealRecordId))
    .orderBy(expenses.date);
}

export async function createExpense(
  workspaceId: string,
  dealRecordId: string,
  input: {
    date: string;
    amount: string;
    category?: "fuel" | "truck_rental" | "equipment" | "subcontractor" | "toll" | "other";
    description?: string;
    recipient?: string;
    paymentMethod?: string;
    receiptFile?: string;
  }
) {
  const [row] = await db
    .insert(expenses)
    .values({ workspaceId, dealRecordId, ...input })
    .returning();
  return row;
}

export async function updateExpense(
  id: string,
  workspaceId: string,
  input: Partial<{
    date: string;
    amount: string;
    category: "fuel" | "truck_rental" | "equipment" | "subcontractor" | "toll" | "other";
    description: string;
    recipient: string;
    paymentMethod: string;
    receiptFile: string;
  }>
) {
  const [row] = await db
    .update(expenses)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}

export async function deleteExpense(id: string, workspaceId: string) {
  const [row] = await db
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .returning({ id: expenses.id });
  return row ?? null;
}

// ─── Employee Transactions ────────────────────────────────────────────────────

export async function listEmployeeTransactions(dealRecordId: string) {
  return db
    .select({
      id: employeeTransactions.id,
      dealRecordId: employeeTransactions.dealRecordId,
      employeeId: employeeTransactions.employeeId,
      employeeName: employees.name,
      date: employeeTransactions.date,
      type: employeeTransactions.type,
      amount: employeeTransactions.amount,
      status: employeeTransactions.status,
      description: employeeTransactions.description,
      notes: employeeTransactions.notes,
      createdAt: employeeTransactions.createdAt,
      updatedAt: employeeTransactions.updatedAt,
    })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(eq(employeeTransactions.dealRecordId, dealRecordId))
    .orderBy(employeeTransactions.date);
}

export async function createEmployeeTransaction(
  workspaceId: string,
  dealRecordId: string,
  input: {
    employeeId: string;
    date: string;
    type: "salary" | "advance" | "reimbursement";
    amount: string;
    status?: "open" | "paid";
    description?: string;
    notes?: string;
  }
) {
  const [row] = await db
    .insert(employeeTransactions)
    .values({ workspaceId, dealRecordId, ...input })
    .returning();
  return row;
}

export async function updateEmployeeTransaction(
  id: string,
  workspaceId: string,
  input: Partial<{
    date: string;
    type: "salary" | "advance" | "reimbursement";
    amount: string;
    status: "open" | "paid";
    description: string;
    notes: string;
  }>
) {
  const [row] = await db
    .update(employeeTransactions)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(employeeTransactions.id, id),
        eq(employeeTransactions.workspaceId, workspaceId)
      )
    )
    .returning();
  return row ?? null;
}

export async function deleteEmployeeTransaction(
  id: string,
  workspaceId: string
) {
  const [row] = await db
    .delete(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.id, id),
        eq(employeeTransactions.workspaceId, workspaceId)
      )
    )
    .returning({ id: employeeTransactions.id });
  return row ?? null;
}

// ─── Profit Summary ───────────────────────────────────────────────────────────

/**
 * Calculates real profitability for a deal from actual financial records.
 * profit = total payments received - total expenses - total employee costs
 */
export async function getProfitSummary(dealRecordId: string) {
  const [paymentsTotal] = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId));

  const [expensesTotal] = await db
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(eq(expenses.dealRecordId, dealRecordId));

  const expensesByCategory = await db
    .select({
      category: expenses.category,
      total: sum(expenses.amount),
    })
    .from(expenses)
    .where(eq(expenses.dealRecordId, dealRecordId))
    .groupBy(expenses.category);

  const [employeeCostsTotal] = await db
    .select({ total: sum(employeeTransactions.amount) })
    .from(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.dealRecordId, dealRecordId),
        // Only count salary and advances as costs, not reimbursements paid back to employees
        sql`${employeeTransactions.type} IN ('salary', 'advance')`
      )
    );

  const employeeCostsByPerson = await db
    .select({
      employeeName: employees.name,
      total: sum(employeeTransactions.amount),
    })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(
      and(
        eq(employeeTransactions.dealRecordId, dealRecordId),
        sql`${employeeTransactions.type} IN ('salary', 'advance')`
      )
    )
    .groupBy(employees.name);

  const revenue = Number(paymentsTotal.total ?? 0);
  const totalExpenses = Number(expensesTotal.total ?? 0);
  const totalEmployeeCosts = Number(employeeCostsTotal.total ?? 0);
  const totalCosts = totalExpenses + totalEmployeeCosts;
  const profit = revenue - totalCosts;

  return {
    revenue,
    costs: {
      expenses: {
        total: totalExpenses,
        byCategory: Object.fromEntries(
          expensesByCategory.map((r) => [r.category, Number(r.total ?? 0)])
        ),
      },
      employees: {
        total: totalEmployeeCosts,
        byPerson: employeeCostsByPerson.map((r) => ({
          name: r.employeeName,
          total: Number(r.total ?? 0),
        })),
      },
      total: totalCosts,
    },
    profit,
    margin: revenue > 0 ? Math.round((profit / revenue) * 100) : null,
  };
}

// ─── Workspace Financial Overview ─────────────────────────────────────────────

/**
 * Workspace-level financial overview, optionally filtered by month ("YYYY-MM").
 * Also returns a per-deal breakdown so the UI can show deal-level rows.
 */
export async function getFinancialOverview(
  workspaceId: string,
  month: string | null = null
) {
  const range = parseMonth(month);

  // Build date conditions per table
  const paymentDateCond = range
    ? and(gte(payments.date, range.start), lt(payments.date, range.end))
    : undefined;
  const expenseDateCond = range
    ? and(gte(expenses.date, range.start), lt(expenses.date, range.end))
    : undefined;
  const empTxDateCond = range
    ? and(gte(employeeTransactions.date, range.start), lt(employeeTransactions.date, range.end))
    : undefined;

  // ── Totals ──────────────────────────────────────────────────────────────────
  const [totalIncome] = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), paymentDateCond));

  const [totalExpensesRow] = await db
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond));

  const [totalEmployeeCostsRow] = await db
    .select({ total: sum(employeeTransactions.amount) })
    .from(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.workspaceId, workspaceId),
        sql`${employeeTransactions.type} IN ('salary', 'advance')`,
        empTxDateCond
      )
    );

  // ── Breakdowns ───────────────────────────────────────────────────────────────
  const expensesByCategory = await db
    .select({ category: expenses.category, total: sum(expenses.amount) })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond))
    .groupBy(expenses.category);

  const employeeBalances = await db
    .select({ employeeName: employees.name, total: sum(employeeTransactions.amount) })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(and(eq(employeeTransactions.workspaceId, workspaceId), empTxDateCond))
    .groupBy(employees.name);

  // ── Per-deal breakdown ────────────────────────────────────────────────────────
  const dealIncome = await db
    .select({ dealRecordId: payments.dealRecordId, total: sum(payments.amount) })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), paymentDateCond))
    .groupBy(payments.dealRecordId);

  const dealExpenses = await db
    .select({ dealRecordId: expenses.dealRecordId, total: sum(expenses.amount) })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond))
    .groupBy(expenses.dealRecordId);

  const dealEmpCosts = await db
    .select({ dealRecordId: employeeTransactions.dealRecordId, total: sum(employeeTransactions.amount) })
    .from(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.workspaceId, workspaceId),
        sql`${employeeTransactions.type} IN ('salary', 'advance')`,
        empTxDateCond
      )
    )
    .groupBy(employeeTransactions.dealRecordId);

  // Merge into deal map
  const dealMap = new Map<string, { income: number; expenses: number; empCosts: number }>();
  for (const r of dealIncome)   { const d = dealMap.get(r.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 }; d.income = Number(r.total ?? 0); dealMap.set(r.dealRecordId, d); }
  for (const r of dealExpenses) { const d = dealMap.get(r.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 }; d.expenses = Number(r.total ?? 0); dealMap.set(r.dealRecordId, d); }
  for (const r of dealEmpCosts) { const d = dealMap.get(r.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 }; d.empCosts = Number(r.total ?? 0); dealMap.set(r.dealRecordId, d); }

  // Enrich with deal numbers + names
  const dealIds = [...dealMap.keys()];
  const dealNumberRows = dealIds.length
    ? await db.select({ dealRecordId: dealNumbers.dealRecordId, dealNumber: dealNumbers.dealNumber }).from(dealNumbers).where(sql`${dealNumbers.dealRecordId} = ANY(${sql`ARRAY[${sql.join(dealIds.map(id => sql`${id}`), sql`, `)}]`})`)
    : [];

  const dealNumberLookup = new Map(dealNumberRows.map(r => [r.dealRecordId, r.dealNumber]));

  // Fetch deal names from record_values
  let dealNames: Array<{ recordId: string; name: string }> = [];
  if (dealIds.length) {
    const rows = await db.execute(
      sql`SELECT rv.record_id, rv.text_value FROM record_values rv INNER JOIN attributes a ON a.id = rv.attribute_id WHERE a.slug = 'name' AND rv.record_id = ANY(ARRAY[${sql.join(dealIds.map(id => sql`${id}`), sql`, `)}]::text[])`
    );
    dealNames = (rows as unknown as Array<{ record_id: string; text_value: string }>).map(r => ({ recordId: r.record_id, name: r.text_value }));
  }
  const dealNameLookup = new Map(dealNames.map(r => [r.recordId, r.name]));

  const deals = [...dealMap.entries()].map(([id, d]) => ({
    dealRecordId: id,
    dealNumber: dealNumberLookup.get(id) ?? "—",
    name: dealNameLookup.get(id) ?? "Unbekannt",
    income: d.income,
    costs: d.expenses + d.empCosts,
    profit: d.income - d.expenses - d.empCosts,
  })).sort((a, b) => b.income - a.income);

  // ── Per-company breakdown ─────────────────────────────────────────────────────
  // Look up which operating company each deal belongs to via record_values
  let companyBreakdown: Array<{
    companyName: string;
    income: number;
    expenses: number;
    employeeCosts: number;
    profit: number;
  }> = [];

  if (dealIds.length) {
    // Find the "operating_company" attribute for the deals object
    const ocAttrRows = await db
      .select({ id: attributes.id })
      .from(attributes)
      .innerJoin(objects, eq(objects.id, attributes.objectId))
      .where(
        and(
          eq(objects.workspaceId, workspaceId),
          eq(objects.slug, "deals"),
          eq(attributes.slug, "operating_company")
        )
      )
      .limit(1);

    if (ocAttrRows.length > 0) {
      const ocAttrId = ocAttrRows[0].id;

      // Get deal → operating company record ID mapping
      const dealOcRows = await db
        .select({
          dealId: recordValues.recordId,
          ocRecordId: recordValues.referencedRecordId,
        })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, ocAttrId),
            sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(dealIds.map(id => sql`${id}`), sql`, `)}]::text[])`,
            sql`${recordValues.referencedRecordId} IS NOT NULL`
          )
        );

      // Get operating company names
      const ocIds = [...new Set(dealOcRows.map(r => r.ocRecordId!))];
      let ocNameLookup = new Map<string, string>();
      if (ocIds.length) {
        // Find the "name" attribute for operating_companies object
        const ocNameAttrRows = await db
          .select({ id: attributes.id })
          .from(attributes)
          .innerJoin(objects, eq(objects.id, attributes.objectId))
          .where(
            and(
              eq(objects.workspaceId, workspaceId),
              eq(objects.slug, "operating_companies"),
              eq(attributes.slug, "name")
            )
          )
          .limit(1);

        if (ocNameAttrRows.length > 0) {
          const nameRows = await db
            .select({ recordId: recordValues.recordId, name: recordValues.textValue })
            .from(recordValues)
            .where(
              and(
                eq(recordValues.attributeId, ocNameAttrRows[0].id),
                sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(ocIds.map(id => sql`${id}`), sql`, `)}]::text[])`
              )
            );
          ocNameLookup = new Map(nameRows.map(r => [r.recordId, r.name ?? "Unbekannt"]));
        }
      }

      // Build deal → company name lookup
      const dealCompanyLookup = new Map(
        dealOcRows.map(r => [r.dealId, ocNameLookup.get(r.ocRecordId!) ?? "Unbekannt"])
      );

      // Aggregate financials per company
      const companyMap = new Map<string, { income: number; expenses: number; empCosts: number }>();
      for (const [dealId, d] of dealMap) {
        const companyName = dealCompanyLookup.get(dealId) ?? "Nicht zugewiesen";
        const existing = companyMap.get(companyName) ?? { income: 0, expenses: 0, empCosts: 0 };
        existing.income += d.income;
        existing.expenses += d.expenses;
        existing.empCosts += d.empCosts;
        companyMap.set(companyName, existing);
      }

      companyBreakdown = [...companyMap.entries()].map(([name, d]) => ({
        companyName: name,
        income: d.income,
        expenses: d.expenses,
        employeeCosts: d.empCosts,
        profit: d.income - d.expenses - d.empCosts,
      })).sort((a, b) => b.income - a.income);
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────────
  const income = Number(totalIncome.total ?? 0);
  const totalExpenses = Number(totalExpensesRow.total ?? 0);
  const totalEmployeeCosts = Number(totalEmployeeCostsRow.total ?? 0);
  const totalCosts = totalExpenses + totalEmployeeCosts;

  return {
    summary: {
      totalIncome: income,
      totalExpenses,
      totalEmployeeCosts,
      totalCosts,
      netProfit: income - totalCosts,
      margin: income > 0 ? Math.round(((income - totalCosts) / income) * 100) : null,
    },
    expensesByCategory: Object.fromEntries(
      expensesByCategory.map((r) => [r.category, Number(r.total ?? 0)])
    ),
    employeeBalances: employeeBalances.map((r) => ({
      name: r.employeeName,
      total: Number(r.total ?? 0),
    })),
    deals,
    companyBreakdown,
  };
}
