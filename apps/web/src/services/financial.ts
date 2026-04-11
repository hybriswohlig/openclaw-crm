import { db } from "@/db";
import {
  dealNumberSequences,
  dealNumbers,
  payments,
  expenses,
  employeeTransactions,
  employees,
} from "@/db/schema";
import { eq, and, sum, sql } from "drizzle-orm";

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

export async function getFinancialOverview(workspaceId: string) {
  const [totalIncome] = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(eq(payments.workspaceId, workspaceId));

  const [totalExpensesRow] = await db
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(eq(expenses.workspaceId, workspaceId));

  const [totalEmployeeCostsRow] = await db
    .select({ total: sum(employeeTransactions.amount) })
    .from(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.workspaceId, workspaceId),
        sql`${employeeTransactions.type} IN ('salary', 'advance')`
      )
    );

  const expensesByCategory = await db
    .select({
      category: expenses.category,
      total: sum(expenses.amount),
    })
    .from(expenses)
    .where(eq(expenses.workspaceId, workspaceId))
    .groupBy(expenses.category);

  const employeeBalances = await db
    .select({
      employeeName: employees.name,
      totalCosts: sum(employeeTransactions.amount),
    })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(eq(employeeTransactions.workspaceId, workspaceId))
    .groupBy(employees.name);

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
    },
    expensesByCategory: Object.fromEntries(
      expensesByCategory.map((r) => [r.category, Number(r.total ?? 0)])
    ),
    employeeBalances: employeeBalances.map((r) => ({
      name: r.employeeName,
      total: Number(r.totalCosts ?? 0),
    })),
  };
}
