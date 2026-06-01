import { db } from "@/db";
import {
  dealNumberSequences,
  dealNumbers,
  payments,
  expenses,
  employees,
  employeeLedger,
  privateTransactions,
} from "@/db/schema";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { eq, and, sum, sql, gte, lt, desc, inArray } from "drizzle-orm";

export type PaymentMethod = "cash" | "bank_transfer" | "other";
export type EmployeeLedgerKind = "earning" | "reimbursement" | "payment";

/**
 * Resolve the live operating company of a deal (the `operating_company`
 * reference attribute on the `deals` object). Returns null if unset.
 */
export async function resolveDealOperatingCompany(
  workspaceId: string,
  dealRecordId: string
): Promise<string | null> {
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
  if (!ocAttr) return null;

  const [row] = await db
    .select({ ref: recordValues.referencedRecordId })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.attributeId, ocAttr.id),
        eq(recordValues.recordId, dealRecordId)
      )
    )
    .limit(1);
  return row?.ref ?? null;
}

/** Returns [startDate, endDate) strings for a "YYYY-MM" month, or null for all-time. */
function parseMonth(month: string | null): { start: string; end: string } | null {
  if (!month) return null;
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(year, m,     1)).toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Monthly income totals for the last `count` months (oldest → newest),
 * used for the dashboard sparkline. Returns numbers, never null.
 */
export async function getIncomeSeries(
  workspaceId: string,
  count: number
): Promise<number[]> {
  const n = Math.max(1, Math.min(count, 24));
  const now = new Date();
  const months: { key: string; start: string; end: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    months.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    });
  }
  const rangeStart = months[0].start;
  const rangeEnd = months[months.length - 1].end;

  const rows = await db
    .select({
      month: sql<string>`to_char(${payments.date}::date, 'YYYY-MM')`,
      total: sum(payments.amount),
    })
    .from(payments)
    .where(
      and(
        eq(payments.workspaceId, workspaceId),
        gte(payments.date, rangeStart),
        lt(payments.date, rangeEnd)
      )
    )
    .groupBy(sql`to_char(${payments.date}::date, 'YYYY-MM')`);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.month, Number(r.total ?? 0));
  return months.map((m) => map.get(m.key) ?? 0);
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

/**
 * All ledger entries linked to a deal (the deal's Personalkosten mini-ledger).
 * Returns earnings, reimbursements and payments in date order.
 */
export async function listDealEmployeeLedger(dealRecordId: string) {
  return db
    .select({
      id: employeeLedger.id,
      dealRecordId: employeeLedger.dealRecordId,
      employeeId: employeeLedger.employeeId,
      employeeName: employees.name,
      date: employeeLedger.date,
      kind: employeeLedger.kind,
      amount: employeeLedger.amount,
      operatingCompanyId: employeeLedger.operatingCompanyId,
      payingOperatingCompanyId: employeeLedger.payingOperatingCompanyId,
      paymentMethod: employeeLedger.paymentMethod,
      description: employeeLedger.description,
      notes: employeeLedger.notes,
      isTaxDeductible: employeeLedger.isTaxDeductible,
      dueDate: employeeLedger.dueDate,
      receiptFile: employeeLedger.receiptFile,
      createdAt: employeeLedger.createdAt,
      updatedAt: employeeLedger.updatedAt,
    })
    .from(employeeLedger)
    .innerJoin(employees, eq(employees.id, employeeLedger.employeeId))
    .where(eq(employeeLedger.dealRecordId, dealRecordId))
    .orderBy(employeeLedger.date);
}

export interface CreateLedgerInput {
  employeeId: string;
  date: string;
  kind: EmployeeLedgerKind;
  amount: string;
  /** Firma deren Konto betroffen ist. Wenn nicht gesetzt & dealRecordId vorhanden → aus dem Auftrag abgeleitet. */
  operatingCompanyId?: string | null;
  /** Quersubvention: eine andere Firma trägt/zahlt den Betrag. */
  payingOperatingCompanyId?: string | null;
  dealRecordId?: string | null;
  paymentMethod?: PaymentMethod | null;
  description?: string | null;
  notes?: string | null;
  isTaxDeductible?: boolean;
  dueDate?: string | null;
  receiptFile?: string | null;
}

/**
 * Create a ledger entry (earning / reimbursement / payment). If
 * `operatingCompanyId` is omitted but a deal is given, it is resolved from the
 * deal's operating company.
 */
export async function createEmployeeLedgerEntry(
  workspaceId: string,
  input: CreateLedgerInput
) {
  let operatingCompanyId = input.operatingCompanyId ?? null;
  if (!operatingCompanyId && input.dealRecordId) {
    operatingCompanyId = await resolveDealOperatingCompany(
      workspaceId,
      input.dealRecordId
    );
  }

  const [row] = await db
    .insert(employeeLedger)
    .values({
      workspaceId,
      employeeId: input.employeeId,
      date: input.date,
      kind: input.kind,
      amount: input.amount,
      operatingCompanyId,
      payingOperatingCompanyId: input.payingOperatingCompanyId ?? null,
      dealRecordId: input.dealRecordId ?? null,
      paymentMethod: input.paymentMethod ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      isTaxDeductible: input.isTaxDeductible ?? true,
      dueDate: input.dueDate ?? null,
      receiptFile: input.receiptFile ?? null,
    })
    .returning();
  return row;
}

export async function updateEmployeeLedgerEntry(
  id: string,
  workspaceId: string,
  input: Partial<{
    date: string;
    kind: EmployeeLedgerKind;
    amount: string;
    operatingCompanyId: string | null;
    payingOperatingCompanyId: string | null;
    dealRecordId: string | null;
    paymentMethod: PaymentMethod | null;
    description: string | null;
    notes: string | null;
    isTaxDeductible: boolean;
    dueDate: string | null;
    receiptFile: string | null;
  }>
) {
  const [row] = await db
    .update(employeeLedger)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(eq(employeeLedger.id, id), eq(employeeLedger.workspaceId, workspaceId))
    )
    .returning();
  return row ?? null;
}

export async function deleteEmployeeLedgerEntry(id: string, workspaceId: string) {
  const [row] = await db
    .delete(employeeLedger)
    .where(
      and(eq(employeeLedger.id, id), eq(employeeLedger.workspaceId, workspaceId))
    )
    .returning({ id: employeeLedger.id });
  return row ?? null;
}

export async function getEmployeeLedgerEntry(id: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(employeeLedger)
    .where(
      and(eq(employeeLedger.id, id), eq(employeeLedger.workspaceId, workspaceId))
    )
    .limit(1);
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
    .select({ total: sum(employeeLedger.amount) })
    .from(employeeLedger)
    .where(
      and(
        eq(employeeLedger.dealRecordId, dealRecordId),
        // Only earnings count as labour cost — reimbursements are paybacks and
        // payments are mere settlements of an already-recognised cost.
        eq(employeeLedger.kind, "earning")
      )
    );

  const employeeCostsByPerson = await db
    .select({
      employeeName: employees.name,
      total: sum(employeeLedger.amount),
    })
    .from(employeeLedger)
    .innerJoin(employees, eq(employees.id, employeeLedger.employeeId))
    .where(
      and(
        eq(employeeLedger.dealRecordId, dealRecordId),
        eq(employeeLedger.kind, "earning")
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
    ? and(gte(employeeLedger.date, range.start), lt(employeeLedger.date, range.end))
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

  // Employee labour cost = `earning` ledger rows (the old salary/advance amounts).
  // Reimbursements + payments do not count as cost here (payments merely settle
  // an already-recognised cost; reimbursements are paybacks).
  const empTxRows = await db
    .select({
      dealRecordId: employeeLedger.dealRecordId,
      operatingCompanyId: employeeLedger.operatingCompanyId,
      amount: employeeLedger.amount,
      employeeName: employees.name,
      payingOperatingCompanyId: employeeLedger.payingOperatingCompanyId,
    })
    .from(employeeLedger)
    .innerJoin(employees, eq(employees.id, employeeLedger.employeeId))
    .where(
      and(
        eq(employeeLedger.workspaceId, workspaceId),
        eq(employeeLedger.kind, "earning"),
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
    ...new Set(
      [
        ...paymentRows.map((r) => r.dealRecordId),
        ...expenseRows.map((r) => r.dealRecordId),
        ...empTxRows.map((r) => r.dealRecordId),
      ].filter((id): id is string => !!id)
    ),
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
  for (const r of empTxRows) {
    if (r.payingOperatingCompanyId) touchedCompanyIds.add(r.payingOperatingCompanyId);
    if (r.operatingCompanyId) touchedCompanyIds.add(r.operatingCompanyId);
  }
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

  // Employee costs → same rules. For deal-linked earnings the company is the
  // deal's live owner; standalone earnings carry their own operating company.
  for (const t of empTxRows) {
    const dealOp = t.dealRecordId
      ? dealCompanyLookup.get(t.dealRecordId) ?? null
      : t.operatingCompanyId ?? null;
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
    if (!t.dealRecordId) continue; // standalone earnings are not part of a deal row
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

// ─── Per-Company Drill-Down ───────────────────────────────────────────────────

export interface CompanyDetails {
  companyId: string | null;
  companyName: string;
  totals: {
    income: number;
    deductibleExpenses: number;
    nonDeductibleExpenses: number;
    employeeCosts: number;
    crossSubsidyIn: number;
    crossSubsidyOut: number;
    privateEinlagen: number;
    privateEntnahmen: number;
    netResult: number;
  };
  /** Income grouped by deal (one slice per deal in the income pie chart). */
  incomeByDeal: Array<{
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
    total: number;
    payments: Array<{
      id: string;
      date: string;
      amount: number;
      payer: string | null;
      paymentMethod: string | null;
      reference: string | null;
      notes: string | null;
    }>;
  }>;
  /** Expense aggregates per category (deductible + non-deductible split). */
  expensesByCategory: Array<{
    category: string;
    total: number;
    deductibleTotal: number;
    nonDeductibleTotal: number;
    count: number;
  }>;
  /** Individual expense entries attributed to this company. */
  expenseEntries: Array<{
    id: string;
    date: string;
    amount: number;
    category: string;
    description: string | null;
    recipient: string | null;
    paymentMethod: string | null;
    isTaxDeductible: boolean;
    isCrossSubsidy: boolean;
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
  }>;
  /** Employee cost aggregates per person. */
  employeeCostsByPerson: Array<{
    employeeName: string;
    total: number;
    deductibleTotal: number;
    nonDeductibleTotal: number;
    count: number;
  }>;
  /** Individual employee transaction entries attributed to this company. */
  employeeEntries: Array<{
    id: string;
    date: string;
    amount: number;
    type: "earning" | "reimbursement" | "payment";
    employeeName: string;
    description: string | null;
    paymentMethod: string | null;
    isTaxDeductible: boolean;
    isCrossSubsidy: boolean;
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
  }>;
  /** Private movements that hit this company's pot. */
  privateEntries: Array<{
    id: string;
    date: string;
    amount: number;
    method: "cash" | "bank_transfer" | "other";
    fromPartner: string;
    toPartner: string | null;
    direction: "einlage" | "entnahme";
    notes: string | null;
  }>;
  /** Expenses paid by another company for this company's deals (Quersubventionen +in). */
  crossSubsidyInEntries: Array<{
    id: string;
    kind: "expense" | "employee";
    date: string;
    amount: number;
    label: string;
    paidByCompanyId: string;
    paidByCompanyName: string;
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
  }>;
}

/**
 * Per-company drill-down for the financial overview. Filters all workspace
 * transactions to those attributed to `companyId` (null = "Nicht zugewiesen")
 * using the same effective-payer rules as `getFinancialOverview`.
 */
export async function getCompanyDetails(
  workspaceId: string,
  companyId: string | null,
  month: string | null = null
): Promise<CompanyDetails> {
  const range = parseMonth(month);

  const paymentDateCond = range
    ? and(gte(payments.date, range.start), lt(payments.date, range.end))
    : undefined;
  const expenseDateCond = range
    ? and(gte(expenses.date, range.start), lt(expenses.date, range.end))
    : undefined;
  const empTxDateCond = range
    ? and(
        gte(employeeLedger.date, range.start),
        lt(employeeLedger.date, range.end)
      )
    : undefined;
  const privateDateCond = range
    ? and(
        gte(privateTransactions.date, range.start),
        lt(privateTransactions.date, range.end)
      )
    : undefined;

  // ── Raw rows ──────────────────────────────────────────────────────────────
  const paymentRows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), paymentDateCond));

  const expenseRows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond));

  // Earnings = labour cost rows (the old salary/advance amounts).
  const empTxRows = await db
    .select({
      id: employeeLedger.id,
      dealRecordId: employeeLedger.dealRecordId,
      operatingCompanyId: employeeLedger.operatingCompanyId,
      employeeName: employees.name,
      date: employeeLedger.date,
      kind: employeeLedger.kind,
      amount: employeeLedger.amount,
      description: employeeLedger.description,
      paymentMethod: employeeLedger.paymentMethod,
      isTaxDeductible: employeeLedger.isTaxDeductible,
      payingOperatingCompanyId: employeeLedger.payingOperatingCompanyId,
    })
    .from(employeeLedger)
    .innerJoin(employees, eq(employees.id, employeeLedger.employeeId))
    .where(
      and(
        eq(employeeLedger.workspaceId, workspaceId),
        eq(employeeLedger.kind, "earning"),
        empTxDateCond
      )
    );

  const privateRows = await db
    .select()
    .from(privateTransactions)
    .where(
      and(eq(privateTransactions.workspaceId, workspaceId), privateDateCond)
    );

  // ── Deal → operating_company + deal name + deal number lookups ───────────
  const dealIds = [
    ...new Set(
      [
        ...paymentRows.map((r) => r.dealRecordId),
        ...expenseRows.map((r) => r.dealRecordId),
        ...empTxRows.map((r) => r.dealRecordId),
      ].filter((id): id is string => !!id)
    ),
  ];

  const dealCompanyLookup = new Map<string, string | null>();
  const dealNumberLookup = new Map<string, string>();
  const dealNameLookup = new Map<string, string>();
  const companyNames = new Map<string, string>();

  if (dealIds.length) {
    // operating_company attribute on deals
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
            sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(
              dealIds.map((id) => sql`${id}`),
              sql`, `
            )}]::text[])`,
            sql`${recordValues.referencedRecordId} IS NOT NULL`
          )
        );
      for (const r of dealOcRows) dealCompanyLookup.set(r.dealId, r.ocRecordId);
    }

    // deal numbers
    const dealNumberRows = await db
      .select({
        dealRecordId: dealNumbers.dealRecordId,
        dealNumber: dealNumbers.dealNumber,
      })
      .from(dealNumbers)
      .where(
        sql`${dealNumbers.dealRecordId} = ANY(ARRAY[${sql.join(
          dealIds.map((id) => sql`${id}`),
          sql`, `
        )}]::text[])`
      );
    for (const r of dealNumberRows)
      dealNumberLookup.set(r.dealRecordId, r.dealNumber);

    // deal names (via record_values + 'name' attribute)
    const nameRows = await db.execute(
      sql`SELECT rv.record_id, rv.text_value FROM record_values rv INNER JOIN attributes a ON a.id = rv.attribute_id WHERE a.slug = 'name' AND rv.record_id = ANY(ARRAY[${sql.join(
        dealIds.map((id) => sql`${id}`),
        sql`, `
      )}]::text[])`
    );
    for (const r of nameRows as unknown as Array<{
      record_id: string;
      text_value: string;
    }>) {
      dealNameLookup.set(r.record_id, r.text_value);
    }
  }

  // ── Operating-company name lookup (every company we'll display) ──────────
  const touchedCompanyIds = new Set<string>();
  if (companyId) touchedCompanyIds.add(companyId);
  for (const r of expenseRows)
    if (r.payingOperatingCompanyId)
      touchedCompanyIds.add(r.payingOperatingCompanyId);
  for (const r of empTxRows) {
    if (r.payingOperatingCompanyId)
      touchedCompanyIds.add(r.payingOperatingCompanyId);
    if (r.operatingCompanyId) touchedCompanyIds.add(r.operatingCompanyId);
  }
  for (const id of dealCompanyLookup.values()) if (id) touchedCompanyIds.add(id);

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
        .select({
          recordId: recordValues.recordId,
          name: recordValues.textValue,
        })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, nameAttr.id),
            sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `
            )}]::text[])`
          )
        );
      for (const r of nameRows)
        companyNames.set(r.recordId, r.name ?? "Unbekannt");
    }
  }

  // ── Income (payments) → attributed to deal owner ──────────────────────────
  const incomePaymentsByDeal = new Map<
    string,
    { total: number; payments: CompanyDetails["incomeByDeal"][number]["payments"] }
  >();
  for (const p of paymentRows) {
    const dealOp = dealCompanyLookup.get(p.dealRecordId) ?? null;
    if (dealOp !== companyId) continue;
    let bucket = incomePaymentsByDeal.get(p.dealRecordId);
    if (!bucket) {
      bucket = { total: 0, payments: [] };
      incomePaymentsByDeal.set(p.dealRecordId, bucket);
    }
    bucket.total += Number(p.amount);
    bucket.payments.push({
      id: p.id,
      date: p.date,
      amount: Number(p.amount),
      payer: p.payer,
      paymentMethod: p.paymentMethod,
      reference: p.reference,
      notes: p.notes,
    });
  }

  const incomeByDeal: CompanyDetails["incomeByDeal"] = [
    ...incomePaymentsByDeal.entries(),
  ]
    .map(([dealRecordId, b]) => ({
      dealRecordId,
      dealNumber: dealNumberLookup.get(dealRecordId) ?? "—",
      dealName: dealNameLookup.get(dealRecordId) ?? "Unbekannt",
      total: b.total,
      payments: b.payments.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.total - a.total);

  // ── Expenses → effective payer ────────────────────────────────────────────
  const expenseEntries: CompanyDetails["expenseEntries"] = [];
  const crossSubsidyInEntries: CompanyDetails["crossSubsidyInEntries"] = [];
  let totalDeductible = 0;
  let totalNonDeductible = 0;
  let totalCrossOut = 0;
  let totalCrossIn = 0;

  for (const e of expenseRows) {
    const dealOp = dealCompanyLookup.get(e.dealRecordId) ?? null;
    const effectivePayer = e.payingOperatingCompanyId ?? dealOp;
    const isCross =
      e.payingOperatingCompanyId !== null &&
      dealOp !== null &&
      e.payingOperatingCompanyId !== dealOp;
    const amt = Number(e.amount);

    if (effectivePayer === companyId) {
      expenseEntries.push({
        id: e.id,
        date: e.date,
        amount: amt,
        category: e.category,
        description: e.description,
        recipient: e.recipient,
        paymentMethod: e.paymentMethod,
        isTaxDeductible: e.isTaxDeductible,
        isCrossSubsidy: isCross,
        dealRecordId: e.dealRecordId,
        dealNumber: dealNumberLookup.get(e.dealRecordId) ?? "—",
        dealName: dealNameLookup.get(e.dealRecordId) ?? "Unbekannt",
      });
      if (e.isTaxDeductible) totalDeductible += amt;
      else totalNonDeductible += amt;
      if (isCross) totalCrossOut += amt;
    }

    // Cross-subsidy IN: this company owns the deal, but someone else paid.
    if (isCross && dealOp === companyId) {
      totalCrossIn += amt;
      crossSubsidyInEntries.push({
        id: e.id,
        kind: "expense",
        date: e.date,
        amount: amt,
        label:
          e.description ??
          e.recipient ??
          (CATEGORY_LABEL_FALLBACK[e.category] ?? e.category),
        paidByCompanyId: e.payingOperatingCompanyId!,
        paidByCompanyName:
          companyNames.get(e.payingOperatingCompanyId!) ?? "Unbekannt",
        dealRecordId: e.dealRecordId,
        dealNumber: dealNumberLookup.get(e.dealRecordId) ?? "—",
        dealName: dealNameLookup.get(e.dealRecordId) ?? "Unbekannt",
      });
    }
  }

  // Aggregate expenses by category (for the pie chart).
  const categoryAgg = new Map<
    string,
    { total: number; deductibleTotal: number; nonDeductibleTotal: number; count: number }
  >();
  for (const e of expenseEntries) {
    let row = categoryAgg.get(e.category);
    if (!row) {
      row = { total: 0, deductibleTotal: 0, nonDeductibleTotal: 0, count: 0 };
      categoryAgg.set(e.category, row);
    }
    row.total += e.amount;
    row.count += 1;
    if (e.isTaxDeductible) row.deductibleTotal += e.amount;
    else row.nonDeductibleTotal += e.amount;
  }
  const expensesByCategory: CompanyDetails["expensesByCategory"] = [
    ...categoryAgg.entries(),
  ]
    .map(([category, r]) => ({ category, ...r }))
    .sort((a, b) => b.total - a.total);

  // ── Employee costs → effective payer ──────────────────────────────────────
  const employeeEntries: CompanyDetails["employeeEntries"] = [];
  let totalEmployeeCosts = 0;

  for (const t of empTxRows) {
    const dealId = t.dealRecordId;
    const dealOp = dealId
      ? dealCompanyLookup.get(dealId) ?? null
      : t.operatingCompanyId ?? null;
    const effectivePayer = t.payingOperatingCompanyId ?? dealOp;
    const isCross =
      t.payingOperatingCompanyId !== null &&
      dealOp !== null &&
      t.payingOperatingCompanyId !== dealOp;
    const amt = Number(t.amount);
    const dealNumber = dealId ? dealNumberLookup.get(dealId) ?? "—" : "—";
    const dealName = dealId
      ? dealNameLookup.get(dealId) ?? "Unbekannt"
      : "Freie Buchung";

    if (effectivePayer === companyId) {
      employeeEntries.push({
        id: t.id,
        date: t.date,
        amount: amt,
        type: t.kind,
        employeeName: t.employeeName,
        description: t.description,
        paymentMethod: t.paymentMethod,
        isTaxDeductible: t.isTaxDeductible,
        isCrossSubsidy: isCross,
        dealRecordId: dealId ?? "",
        dealNumber,
        dealName,
      });
      totalEmployeeCosts += amt;
      if (isCross) totalCrossOut += amt;
    }

    if (isCross && dealOp === companyId) {
      totalCrossIn += amt;
      crossSubsidyInEntries.push({
        id: t.id,
        kind: "employee",
        date: t.date,
        amount: amt,
        label: `${t.employeeName} — Verdienst`,
        paidByCompanyId: t.payingOperatingCompanyId!,
        paidByCompanyName:
          companyNames.get(t.payingOperatingCompanyId!) ?? "Unbekannt",
        dealRecordId: dealId ?? "",
        dealNumber,
        dealName,
      });
    }
  }

  // Aggregate employee costs by person.
  const employeeAgg = new Map<
    string,
    { total: number; deductibleTotal: number; nonDeductibleTotal: number; count: number }
  >();
  for (const t of employeeEntries) {
    let row = employeeAgg.get(t.employeeName);
    if (!row) {
      row = { total: 0, deductibleTotal: 0, nonDeductibleTotal: 0, count: 0 };
      employeeAgg.set(t.employeeName, row);
    }
    row.total += t.amount;
    row.count += 1;
    if (t.isTaxDeductible) row.deductibleTotal += t.amount;
    else row.nonDeductibleTotal += t.amount;
  }
  const employeeCostsByPerson: CompanyDetails["employeeCostsByPerson"] = [
    ...employeeAgg.entries(),
  ]
    .map(([employeeName, r]) => ({ employeeName, ...r }))
    .sort((a, b) => b.total - a.total);

  // ── Private transactions hit this company's pot directly ──────────────────
  const privateEntries: CompanyDetails["privateEntries"] = [];
  let totalEinlagen = 0;
  let totalEntnahmen = 0;
  for (const p of privateRows) {
    if (p.operatingCompanyId !== companyId) continue;
    const amt = Number(p.amount);
    privateEntries.push({
      id: p.id,
      date: p.date,
      amount: amt,
      method: p.method,
      fromPartner: p.fromPartner,
      toPartner: p.toPartner,
      direction: p.direction,
      notes: p.notes,
    });
    if (p.direction === "einlage") totalEinlagen += amt;
    else totalEntnahmen += amt;
  }

  // ── Compose totals (mirror getFinancialOverview's netResult formula) ─────
  const totalIncome = incomeByDeal.reduce((s, d) => s + d.total, 0);
  const netResult =
    totalIncome +
    totalCrossIn +
    totalEinlagen -
    totalDeductible -
    totalNonDeductible -
    totalEmployeeCosts -
    totalEntnahmen;

  const companyName =
    companyId === null
      ? "Nicht zugewiesen"
      : companyNames.get(companyId) ?? "Unbekannt";

  return {
    companyId,
    companyName,
    totals: {
      income: totalIncome,
      deductibleExpenses: totalDeductible,
      nonDeductibleExpenses: totalNonDeductible,
      employeeCosts: totalEmployeeCosts,
      crossSubsidyIn: totalCrossIn,
      crossSubsidyOut: totalCrossOut,
      privateEinlagen: totalEinlagen,
      privateEntnahmen: totalEntnahmen,
      netResult,
    },
    incomeByDeal,
    expensesByCategory,
    expenseEntries: expenseEntries.sort((a, b) => b.date.localeCompare(a.date)),
    employeeCostsByPerson,
    employeeEntries: employeeEntries.sort((a, b) => b.date.localeCompare(a.date)),
    privateEntries: privateEntries.sort((a, b) => b.date.localeCompare(a.date)),
    crossSubsidyInEntries: crossSubsidyInEntries.sort((a, b) =>
      b.date.localeCompare(a.date)
    ),
  };
}

// Server-side fallback labels (UI re-translates, but the cross-subsidy "label"
// field is plain text — without a deal description we want a readable category).
const CATEGORY_LABEL_FALLBACK: Record<string, string> = {
  fuel: "Kraftstoff",
  truck_rental: "LKW-Miete",
  equipment: "Ausstattung",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};
