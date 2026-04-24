import { db } from "@/db";
import {
  dealNumberSequences,
  dealNumbers,
  payments,
  expenses,
  employeeTransactions,
  employees,
  privateTransactions,
} from "@/db/schema";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { eq, and, sum, sql, gte, lt, desc } from "drizzle-orm";

export type PaymentMethod = "cash" | "bank_transfer" | "other";

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
    isTaxDeductible?: boolean;
    payingOperatingCompanyId?: string | null;
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
    isTaxDeductible: boolean;
    payingOperatingCompanyId: string | null;
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
      amountPaid: employeeTransactions.amountPaid,
      dueDate: employeeTransactions.dueDate,
      status: employeeTransactions.status,
      description: employeeTransactions.description,
      notes: employeeTransactions.notes,
      paymentMethod: employeeTransactions.paymentMethod,
      isTaxDeductible: employeeTransactions.isTaxDeductible,
      payingOperatingCompanyId: employeeTransactions.payingOperatingCompanyId,
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
    amountPaid?: string;
    dueDate?: string | null;
    status?: "open" | "paid";
    description?: string;
    notes?: string;
    paymentMethod?: PaymentMethod | null;
    isTaxDeductible?: boolean;
    payingOperatingCompanyId?: string | null;
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
    amountPaid: string;
    dueDate: string | null;
    status: "open" | "paid";
    description: string;
    notes: string;
    paymentMethod: PaymentMethod | null;
    isTaxDeductible: boolean;
    payingOperatingCompanyId: string | null;
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

/**
 * Record a payment against an employee transaction. Increments amount_paid by
 * the given delta (negative is allowed but clamped to 0). Mirrors status to
 * "paid" once amount_paid >= amount.
 */
export async function recordEmployeeTransactionPayment(
  id: string,
  workspaceId: string,
  delta: number
) {
  const [existing] = await db
    .select()
    .from(employeeTransactions)
    .where(and(eq(employeeTransactions.id, id), eq(employeeTransactions.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return null;

  const total = Number(existing.amount);
  const current = Number(existing.amountPaid);
  const next = Math.max(0, current + delta);
  const nextStatus: "open" | "paid" = next + 0.005 >= total ? "paid" : "open";

  const [row] = await db
    .update(employeeTransactions)
    .set({ amountPaid: next.toFixed(2), status: nextStatus, updatedAt: new Date() })
    .where(eq(employeeTransactions.id, id))
    .returning();
  return row;
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

// ─── Private Transactions ─────────────────────────────────────────────────────

export async function listPrivateTransactions(workspaceId: string) {
  return db
    .select()
    .from(privateTransactions)
    .where(eq(privateTransactions.workspaceId, workspaceId))
    .orderBy(desc(privateTransactions.date));
}

export async function createPrivateTransaction(
  workspaceId: string,
  input: {
    date: string;
    amount: string;
    method: PaymentMethod;
    fromPartner: string;
    toPartner?: string | null;
    operatingCompanyId: string;
    direction: "einlage" | "entnahme";
    notes?: string | null;
  }
) {
  const [row] = await db
    .insert(privateTransactions)
    .values({ workspaceId, ...input })
    .returning();
  return row;
}

export async function updatePrivateTransaction(
  id: string,
  workspaceId: string,
  input: Partial<{
    date: string;
    amount: string;
    method: PaymentMethod;
    fromPartner: string;
    toPartner: string | null;
    operatingCompanyId: string;
    direction: "einlage" | "entnahme";
    notes: string | null;
  }>
) {
  const [row] = await db
    .update(privateTransactions)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(privateTransactions.id, id),
        eq(privateTransactions.workspaceId, workspaceId)
      )
    )
    .returning();
  return row ?? null;
}

export async function deletePrivateTransaction(
  id: string,
  workspaceId: string
) {
  const [row] = await db
    .delete(privateTransactions)
    .where(
      and(
        eq(privateTransactions.id, id),
        eq(privateTransactions.workspaceId, workspaceId)
      )
    )
    .returning({ id: privateTransactions.id });
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

export interface CompanyBreakdownRow {
  companyId: string | null;
  companyName: string;
  income: number;
  deductibleExpenses: number;
  nonDeductibleExpenses: number;
  employeeCosts: number;
  crossSubsidyIn: number;
  crossSubsidyOut: number;
  privateEinlagen: number;
  privateEntnahmen: number;
  netResult: number;
}

/**
 * Workspace-level financial overview, optionally filtered by month ("YYYY-MM").
 *
 * Per-company attribution rules:
 *   - Income: always to the Auftrag owner (deal.operating_company).
 *   - Expense / employee-tx: attributed to `paying_operating_company_id` if set,
 *     otherwise to the deal's operating_company. If `paying_op != deal_op` the
 *     row counts as a cross-subsidy (Quersubvention) for transparency.
 *   - Private transactions: hit the company's pot directly. Einlage += cash,
 *     Entnahme -= cash.
 */
export async function getFinancialOverview(
  workspaceId: string,
  month: string | null = null
) {
  const range = parseMonth(month);

  const paymentDateCond = range
    ? and(gte(payments.date, range.start), lt(payments.date, range.end))
    : undefined;
  const expenseDateCond = range
    ? and(gte(expenses.date, range.start), lt(expenses.date, range.end))
    : undefined;
  const empTxDateCond = range
    ? and(gte(employeeTransactions.date, range.start), lt(employeeTransactions.date, range.end))
    : undefined;
  const privateDateCond = range
    ? and(gte(privateTransactions.date, range.start), lt(privateTransactions.date, range.end))
    : undefined;

  // ── Raw rows ──────────────────────────────────────────────────────────────
  const paymentRows = await db
    .select({
      dealRecordId: payments.dealRecordId,
      amount: payments.amount,
    })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), paymentDateCond));

  const expenseRows = await db
    .select({
      dealRecordId: expenses.dealRecordId,
      amount: expenses.amount,
      category: expenses.category,
      isTaxDeductible: expenses.isTaxDeductible,
      payingOperatingCompanyId: expenses.payingOperatingCompanyId,
    })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond));

  const empTxRows = await db
    .select({
      dealRecordId: employeeTransactions.dealRecordId,
      amount: employeeTransactions.amount,
      type: employeeTransactions.type,
      employeeName: employees.name,
      payingOperatingCompanyId: employeeTransactions.payingOperatingCompanyId,
    })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(
      and(
        eq(employeeTransactions.workspaceId, workspaceId),
        sql`${employeeTransactions.type} IN ('salary', 'advance')`,
        empTxDateCond
      )
    );

  const privateRows = await db
    .select()
    .from(privateTransactions)
    .where(
      and(eq(privateTransactions.workspaceId, workspaceId), privateDateCond)
    );

  // ── Deal → operating_company lookup ───────────────────────────────────────
  const dealIds = [
    ...new Set([
      ...paymentRows.map((r) => r.dealRecordId),
      ...expenseRows.map((r) => r.dealRecordId),
      ...empTxRows.map((r) => r.dealRecordId),
    ]),
  ];

  const dealCompanyLookup = new Map<string, string | null>(); // dealId → op_company_id
  const companyNames = new Map<string, string>(); // op_company_id → name

  if (dealIds.length) {
    const [ocAttr] = await db
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

    if (ocAttr) {
      const dealOcRows = await db
        .select({
          dealId: recordValues.recordId,
          ocRecordId: recordValues.referencedRecordId,
        })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, ocAttr.id),
            sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(dealIds.map((id) => sql`${id}`), sql`, `)}]::text[])`,
            sql`${recordValues.referencedRecordId} IS NOT NULL`
          )
        );
      for (const r of dealOcRows) dealCompanyLookup.set(r.dealId, r.ocRecordId);
    }
  }

  // Collect every op_company we actually see (from deals + payingOp overrides + private)
  const touchedCompanyIds = new Set<string>();
  for (const id of dealCompanyLookup.values()) if (id) touchedCompanyIds.add(id);
  for (const r of expenseRows) if (r.payingOperatingCompanyId) touchedCompanyIds.add(r.payingOperatingCompanyId);
  for (const r of empTxRows)   if (r.payingOperatingCompanyId) touchedCompanyIds.add(r.payingOperatingCompanyId);
  for (const r of privateRows) touchedCompanyIds.add(r.operatingCompanyId);

  if (touchedCompanyIds.size) {
    const [nameAttr] = await db
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

    if (nameAttr) {
      const ids = [...touchedCompanyIds];
      const nameRows = await db
        .select({ recordId: recordValues.recordId, name: recordValues.textValue })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, nameAttr.id),
            sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[])`
          )
        );
      for (const r of nameRows) companyNames.set(r.recordId, r.name ?? "Unbekannt");
    }
  }

  // ── Aggregate per company ─────────────────────────────────────────────────
  const UNASSIGNED = "__unassigned__";
  const blankRow = (): Omit<CompanyBreakdownRow, "companyId" | "companyName" | "netResult"> => ({
    income: 0,
    deductibleExpenses: 0,
    nonDeductibleExpenses: 0,
    employeeCosts: 0,
    crossSubsidyIn: 0,
    crossSubsidyOut: 0,
    privateEinlagen: 0,
    privateEntnahmen: 0,
  });

  const byCompany = new Map<string, ReturnType<typeof blankRow>>();
  const bump = (companyId: string | null): ReturnType<typeof blankRow> => {
    const key = companyId ?? UNASSIGNED;
    let row = byCompany.get(key);
    if (!row) {
      row = blankRow();
      byCompany.set(key, row);
    }
    return row;
  };

  // Income → Auftrag owner
  for (const p of paymentRows) {
    const dealOp = dealCompanyLookup.get(p.dealRecordId) ?? null;
    bump(dealOp).income += Number(p.amount);
  }

  // Expenses → effective payer; cross-subsidy bookkeeping
  for (const e of expenseRows) {
    const dealOp = dealCompanyLookup.get(e.dealRecordId) ?? null;
    const effectivePayer = e.payingOperatingCompanyId ?? dealOp;
    const amt = Number(e.amount);
    const isCross =
      e.payingOperatingCompanyId !== null &&
      dealOp !== null &&
      e.payingOperatingCompanyId !== dealOp;

    const r = bump(effectivePayer);
    if (e.isTaxDeductible) r.deductibleExpenses += amt;
    else r.nonDeductibleExpenses += amt;
    if (isCross) r.crossSubsidyOut += amt;

    // The "beneficiary" company (deal owner) got its expense paid by someone else.
    if (isCross && dealOp) {
      bump(dealOp).crossSubsidyIn += amt;
    }
  }

  // Employee costs → same rules
  for (const t of empTxRows) {
    const dealOp = dealCompanyLookup.get(t.dealRecordId) ?? null;
    const effectivePayer = t.payingOperatingCompanyId ?? dealOp;
    const amt = Number(t.amount);
    const isCross =
      t.payingOperatingCompanyId !== null &&
      dealOp !== null &&
      t.payingOperatingCompanyId !== dealOp;

    const r = bump(effectivePayer);
    r.employeeCosts += amt;
    if (isCross) r.crossSubsidyOut += amt;
    if (isCross && dealOp) bump(dealOp).crossSubsidyIn += amt;
  }

  // Private movements → direct hits to a company's pot
  for (const pt of privateRows) {
    const amt = Number(pt.amount);
    const r = bump(pt.operatingCompanyId);
    if (pt.direction === "einlage") r.privateEinlagen += amt;
    else r.privateEntnahmen += amt;
  }

  const companyBreakdown: CompanyBreakdownRow[] = [...byCompany.entries()].map(
    ([key, r]) => {
      const companyId = key === UNASSIGNED ? null : key;
      const companyName =
        companyId === null
          ? "Nicht zugewiesen"
          : companyNames.get(companyId) ?? "Unbekannt";
      // Net cash result for the company's pot:
      //   income + crossIn + einlagen  -  deductible - nonDeductible - employeeCosts - crossOut - entnahmen
      //
      // Note: expenses attributed via effectivePayer already include the
      // crossOut amount in deductible/nonDeductible, so subtracting crossOut on
      // top would double-count. The breakdown below shows crossOut as a
      // transparency line only; it is NOT subtracted again in netResult.
      const netResult =
        r.income +
        r.crossSubsidyIn +
        r.privateEinlagen -
        r.deductibleExpenses -
        r.nonDeductibleExpenses -
        r.employeeCosts -
        r.privateEntnahmen;
      return {
        companyId,
        companyName,
        ...r,
        netResult,
      };
    }
  ).sort((a, b) => b.income - a.income);

  // ── Per-deal breakdown (unchanged shape; used by DealsTable) ──────────────
  const dealMap = new Map<string, { income: number; expenses: number; empCosts: number }>();
  for (const p of paymentRows) {
    const d = dealMap.get(p.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 };
    d.income += Number(p.amount);
    dealMap.set(p.dealRecordId, d);
  }
  for (const e of expenseRows) {
    const d = dealMap.get(e.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 };
    d.expenses += Number(e.amount);
    dealMap.set(e.dealRecordId, d);
  }
  for (const t of empTxRows) {
    const d = dealMap.get(t.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 };
    d.empCosts += Number(t.amount);
    dealMap.set(t.dealRecordId, d);
  }

  let dealNumberLookup = new Map<string, string>();
  let dealNameLookup = new Map<string, string>();
  if (dealIds.length) {
    const dealNumberRows = await db
      .select({ dealRecordId: dealNumbers.dealRecordId, dealNumber: dealNumbers.dealNumber })
      .from(dealNumbers)
      .where(sql`${dealNumbers.dealRecordId} = ANY(ARRAY[${sql.join(dealIds.map((id) => sql`${id}`), sql`, `)}]::text[])`);
    dealNumberLookup = new Map(dealNumberRows.map((r) => [r.dealRecordId, r.dealNumber]));

    const rows = await db.execute(
      sql`SELECT rv.record_id, rv.text_value FROM record_values rv INNER JOIN attributes a ON a.id = rv.attribute_id WHERE a.slug = 'name' AND rv.record_id = ANY(ARRAY[${sql.join(dealIds.map((id) => sql`${id}`), sql`, `)}]::text[])`
    );
    dealNameLookup = new Map(
      (rows as unknown as Array<{ record_id: string; text_value: string }>).map((r) => [r.record_id, r.text_value])
    );
  }

  const deals = [...dealMap.entries()]
    .map(([id, d]) => ({
      dealRecordId: id,
      dealNumber: dealNumberLookup.get(id) ?? "—",
      name: dealNameLookup.get(id) ?? "Unbekannt",
      income: d.income,
      costs: d.expenses + d.empCosts,
      profit: d.income - d.expenses - d.empCosts,
    }))
    .sort((a, b) => b.income - a.income);

  // ── Expenses by category + employee balances (legacy top-level shape) ─────
  const expensesByCategory: Record<string, number> = {};
  for (const e of expenseRows) {
    expensesByCategory[e.category] =
      (expensesByCategory[e.category] ?? 0) + Number(e.amount);
  }

  const employeeTotals = new Map<string, number>();
  for (const t of empTxRows) {
    employeeTotals.set(
      t.employeeName,
      (employeeTotals.get(t.employeeName) ?? 0) + Number(t.amount)
    );
  }
  const employeeBalances = [...employeeTotals.entries()].map(([name, total]) => ({
    name,
    total,
  }));

  // ── Workspace-level summary ───────────────────────────────────────────────
  const totalIncome = paymentRows.reduce((s, p) => s + Number(p.amount), 0);
  const totalDeductibleExpenses = expenseRows
    .filter((e) => e.isTaxDeductible)
    .reduce((s, e) => s + Number(e.amount), 0);
  const totalNonDeductibleExpenses = expenseRows
    .filter((e) => !e.isTaxDeductible)
    .reduce((s, e) => s + Number(e.amount), 0);
  const totalExpenses = totalDeductibleExpenses + totalNonDeductibleExpenses;
  const totalEmployeeCosts = empTxRows.reduce((s, t) => s + Number(t.amount), 0);
  const totalPrivateEinlagen = privateRows
    .filter((p) => p.direction === "einlage")
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalPrivateEntnahmen = privateRows
    .filter((p) => p.direction === "entnahme")
    .reduce((s, p) => s + Number(p.amount), 0);

  const netProfit =
    totalIncome + totalPrivateEinlagen
    - totalExpenses - totalEmployeeCosts - totalPrivateEntnahmen;

  return {
    summary: {
      totalIncome,
      totalExpenses,
      totalDeductibleExpenses,
      totalNonDeductibleExpenses,
      totalEmployeeCosts,
      totalPrivateEinlagen,
      totalPrivateEntnahmen,
      totalCosts: totalExpenses + totalEmployeeCosts,
      netProfit,
      margin: totalIncome > 0 ? Math.round((netProfit / totalIncome) * 100) : null,
    },
    expensesByCategory,
    employeeBalances,
    deals,
    companyBreakdown,
    privateTransactions: privateRows.map((p) => ({
      id: p.id,
      date: p.date,
      amount: Number(p.amount),
      method: p.method,
      fromPartner: p.fromPartner,
      toPartner: p.toPartner,
      operatingCompanyId: p.operatingCompanyId,
      operatingCompanyName:
        companyNames.get(p.operatingCompanyId) ?? "Unbekannt",
      direction: p.direction,
      notes: p.notes,
    })),
  };
}
