import { db } from "@/db";
import {
  dealNumberSequences,
  dealNumbers,
  payments,
  expenses,
  employees,
  employeeLedger,
  privateTransactions,
  belegNumberCounters,
} from "@/db/schema";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { eq, and, sum, sql, gte, lt, desc, inArray, isNull } from "drizzle-orm";
import {
  EXPENSE_CATEGORIES,
  type ExpenseTaxTreatment,
  type IncomeTaxTreatment,
} from "@/lib/expense-categories";

export type PaymentMethod = "cash" | "bank_transfer" | "other";
export type ExpenseCategory =
  | "fuel"
  | "truck_rental"
  | "vehicle"
  | "repairs"
  | "equipment"
  | "office"
  | "rent"
  | "insurance"
  | "phone_internet"
  | "advertising"
  | "subcontractor"
  | "toll"
  | "tax_advisor"
  | "entertainment"
  | "gifts"
  | "fines"
  | "other";
export type EmployeeLedgerKind =
  | "earning"
  | "reimbursement"
  | "payment"
  | "in_kind";

/**
 * Ledger kinds that count as Personalkosten / Betriebsausgabe (owner decision
 * 2026-06-12): earnings, plus reimbursements (Auslagen, z.B. Sprit) and
 * in-kind purchases (Sachbezug). `payment` rows stay excluded — they merely
 * settle an already-recognised earning in cash.
 */
const COST_LEDGER_KINDS: EmployeeLedgerKind[] = [
  "earning",
  "reimbursement",
  "in_kind",
];

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

// ─── Tax treatment helpers ────────────────────────────────────────────────────

/** Cents-safe rounding for per-row money math. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Default deductible share for "teilweise" rows missing a percent (Bewirtung). */
const DEFAULT_PARTIAL_PERCENT = 70;

const isExpenseTreatment = (t: unknown): t is ExpenseTaxTreatment =>
  t === "voll" || t === "teilweise" || t === "nicht";

/**
 * Split an expense amount into its deductible and non-deductible part based
 * on the row's taxTreatment:
 *   - "voll"      → fully deductible
 *   - "teilweise" → amount * deductiblePercent/100 deductible (fallback 70),
 *                   the remainder counts as non-deductible
 *   - "nicht"     → fully non-deductible
 * Rounded to cents per row.
 */
export function splitExpenseAmount(
  amount: number,
  taxTreatment: string,
  deductiblePercent: number | null | undefined
): { deductible: number; nonDeductible: number } {
  if (taxTreatment === "nicht") {
    return { deductible: 0, nonDeductible: round2(amount) };
  }
  if (taxTreatment === "teilweise") {
    const pct = deductiblePercent ?? DEFAULT_PARTIAL_PERCENT;
    const deductible = round2((amount * pct) / 100);
    return { deductible, nonDeductible: round2(amount - deductible) };
  }
  return { deductible: round2(amount), nonDeductible: 0 };
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

// ─── Belegnummern ─────────────────────────────────────────────────────────────
// Fortlaufende Belegnummern je Firma, Jahr und Buchungsart, assigned at
// booking time for tax-relevant rows. Numbers are never cleared or reused.

/** db or a transaction handle — assignReceiptNumber works inside both. */
type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Belegnummern use the year of the booking date, not the wall-clock year. */
const yearOfDate = (date: string): number => {
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 1970 ? y : new Date().getFullYear();
};

/**
 * Resolve the uppercase first letter of an operating company's display name
 * (the `name` attribute on `operating_companies`, same lookup as the
 * overview). Returns null when no name is resolvable. `cache` avoids
 * repeated lookups within one call site (used by the backfill script).
 */
async function resolveCompanyInitial(
  dbc: DbClient,
  workspaceId: string,
  operatingCompanyId: string,
  cache?: Map<string, string | null>
): Promise<string | null> {
  const cached = cache?.get(operatingCompanyId);
  if (cached !== undefined) return cached;

  let initial: string | null = null;
  const [nameAttr] = await dbc
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
    const [row] = await dbc
      .select({ name: recordValues.textValue })
      .from(recordValues)
      .where(
        and(
          eq(recordValues.attributeId, nameAttr.id),
          eq(recordValues.recordId, operatingCompanyId)
        )
      )
      .limit(1);
    const trimmed = row?.name?.trim();
    initial = trimmed ? trimmed[0].toUpperCase() : null;
  }
  cache?.set(operatingCompanyId, initial);
  return initial;
}

/**
 * Atomically assigns the next Belegnummer for a company, year and booking
 * kind. Format: `${companyInitial}-${E|A}-${year}-${NNNN}` (E = Einnahme,
 * A = Ausgabe), e.g. "K-E-2026-0001". Safe under concurrent inserts via
 * INSERT ... ON CONFLICT DO UPDATE.
 *
 * Returns null when `operatingCompanyId` is null (no number without a
 * company) or when the company has no resolvable display name.
 */
export async function assignReceiptNumber(
  dbc: DbClient,
  params: {
    workspaceId: string;
    operatingCompanyId: string | null;
    year: number;
    kind: "income" | "expense";
  },
  initialCache?: Map<string, string | null>
): Promise<string | null> {
  const { workspaceId, operatingCompanyId, year, kind } = params;
  if (!operatingCompanyId) return null;

  const initial = await resolveCompanyInitial(
    dbc,
    workspaceId,
    operatingCompanyId,
    initialCache
  );
  if (!initial) return null;

  const [row] = await dbc
    .insert(belegNumberCounters)
    .values({ workspaceId, operatingCompanyId, year, kind, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [
        belegNumberCounters.workspaceId,
        belegNumberCounters.operatingCompanyId,
        belegNumberCounters.year,
        belegNumberCounters.kind,
      ],
      set: { lastNumber: sql`${belegNumberCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: belegNumberCounters.lastNumber });

  const letter = kind === "income" ? "E" : "A";
  return `${initial}-${letter}-${year}-${String(row.lastNumber).padStart(4, "0")}`;
}

// ─── Payments ──────────────────────────────────────────────────────────────────

export async function listPayments(dealRecordId: string) {
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId))
    .orderBy(payments.date);
  // payments carry no receipt column → hasReceipt is always false (for now).
  return rows.map((r) => ({ ...r, hasReceipt: false }));
}

export interface CreatePaymentInput {
  date: string;
  amount: string;
  payer?: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  /** Steuerliche Behandlung. Default "betriebseinnahme". */
  taxTreatment?: IncomeTaxTreatment;
  /** Snapshot der Betriebsgesellschaft. Wenn nicht gesetzt → aus dem Auftrag abgeleitet. */
  operatingCompanyId?: string | null;
}

export async function createPayment(
  workspaceId: string,
  dealRecordId: string,
  input: CreatePaymentInput
) {
  const operatingCompanyId =
    input.operatingCompanyId ??
    (await resolveDealOperatingCompany(workspaceId, dealRecordId));
  const taxTreatment: IncomeTaxTreatment =
    input.taxTreatment ?? "betriebseinnahme";
  const receiptNumber =
    taxTreatment === "betriebseinnahme"
      ? await assignReceiptNumber(db, {
          workspaceId,
          operatingCompanyId,
          year: yearOfDate(input.date),
          kind: "income",
        })
      : null;
  const [row] = await db
    .insert(payments)
    .values({
      workspaceId,
      dealRecordId,
      ...input,
      operatingCompanyId,
      taxTreatment,
      receiptNumber,
    })
    .returning();
  return row;
}

export type UpdatePaymentInput = Partial<{
  date: string;
  amount: string;
  payer: string;
  paymentMethod: string;
  reference: string;
  notes: string;
  taxTreatment: IncomeTaxTreatment;
  operatingCompanyId: string | null;
}>;

export async function updatePayment(
  id: string,
  workspaceId: string,
  input: UpdatePaymentInput
) {
  const set: Partial<typeof payments.$inferInsert> = {
    ...input,
    updatedAt: new Date(),
  };

  // Transition into the numbered state: assign a Belegnummer once when the
  // row has none yet. Numbers are never cleared or reused.
  if (input.taxTreatment === "betriebseinnahme") {
    const [existing] = await db
      .select({
        receiptNumber: payments.receiptNumber,
        operatingCompanyId: payments.operatingCompanyId,
        dealRecordId: payments.dealRecordId,
        date: payments.date,
      })
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.workspaceId, workspaceId)))
      .limit(1);
    if (existing && existing.receiptNumber === null) {
      const companyId =
        input.operatingCompanyId ??
        existing.operatingCompanyId ??
        (existing.dealRecordId
          ? await resolveDealOperatingCompany(workspaceId, existing.dealRecordId)
          : null);
      const receiptNumber = await assignReceiptNumber(db, {
        workspaceId,
        operatingCompanyId: companyId,
        year: yearOfDate(input.date ?? existing.date),
        kind: "income",
      });
      if (receiptNumber) set.receiptNumber = receiptNumber;
    }
  }

  const [row] = await db
    .update(payments)
    .set(set)
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

/**
 * Deal-bound expense list. Ships `hasReceipt` instead of the base64
 * `receiptFile` — fetch the file via `getBookingReceipt` / the receipt route.
 */
export async function listExpenses(dealRecordId: string) {
  return db
    .select({
      id: expenses.id,
      workspaceId: expenses.workspaceId,
      dealRecordId: expenses.dealRecordId,
      operatingCompanyId: expenses.operatingCompanyId,
      date: expenses.date,
      amount: expenses.amount,
      category: expenses.category,
      description: expenses.description,
      recipient: expenses.recipient,
      paymentMethod: expenses.paymentMethod,
      receiptJobMediaId: expenses.receiptJobMediaId,
      isTaxDeductible: expenses.isTaxDeductible,
      taxTreatment: expenses.taxTreatment,
      deductiblePercent: expenses.deductiblePercent,
      receiptNumber: expenses.receiptNumber,
      payingOperatingCompanyId: expenses.payingOperatingCompanyId,
      hasReceipt: sql<boolean>`(${expenses.receiptFile} IS NOT NULL OR ${expenses.receiptJobMediaId} IS NOT NULL)`,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
    })
    .from(expenses)
    .where(eq(expenses.dealRecordId, dealRecordId))
    .orderBy(expenses.date);
}

export interface CreateExpenseInput {
  date: string;
  amount: string;
  category?: ExpenseCategory;
  description?: string;
  recipient?: string;
  paymentMethod?: string;
  receiptFile?: string;
  receiptJobMediaId?: string | null;
  /** Legacy binary flag; ignored when taxTreatment is given. */
  isTaxDeductible?: boolean;
  /** Steuerliche Behandlung. Default "voll" (bzw. "nicht" bei isTaxDeductible false). */
  taxTreatment?: ExpenseTaxTreatment;
  /** Abzugsfaehiger Anteil in Prozent. Only used when taxTreatment "teilweise" (default 70). */
  deductiblePercent?: number | null;
  payingOperatingCompanyId?: string | null;
  /** Snapshot der Betriebsgesellschaft. Wenn nicht gesetzt → aus dem Auftrag abgeleitet. */
  operatingCompanyId?: string | null;
}

export async function createExpense(
  workspaceId: string,
  dealRecordId: string,
  input: CreateExpenseInput
) {
  const operatingCompanyId =
    input.operatingCompanyId ??
    (await resolveDealOperatingCompany(workspaceId, dealRecordId));
  const taxTreatment: ExpenseTaxTreatment =
    input.taxTreatment ?? (input.isTaxDeductible === false ? "nicht" : "voll");
  const deductiblePercent =
    taxTreatment === "teilweise"
      ? input.deductiblePercent ?? DEFAULT_PARTIAL_PERCENT
      : null;
  const receiptNumber =
    taxTreatment !== "nicht"
      ? await assignReceiptNumber(db, {
          workspaceId,
          operatingCompanyId,
          year: yearOfDate(input.date),
          kind: "expense",
        })
      : null;
  const [row] = await db
    .insert(expenses)
    .values({
      workspaceId,
      dealRecordId,
      ...input,
      operatingCompanyId,
      taxTreatment,
      deductiblePercent,
      // Legacy flag kept in sync until all readers are migrated.
      isTaxDeductible: taxTreatment !== "nicht",
      receiptNumber,
    })
    .returning();
  return row;
}

export type UpdateExpenseInput = Partial<{
  date: string;
  amount: string;
  category: ExpenseCategory;
  description: string;
  recipient: string;
  paymentMethod: string;
  receiptFile: string;
  /** Legacy binary flag; mapped onto taxTreatment when given alone. */
  isTaxDeductible: boolean;
  taxTreatment: ExpenseTaxTreatment;
  deductiblePercent: number | null;
  payingOperatingCompanyId: string | null;
  operatingCompanyId: string | null;
}>;

export async function updateExpense(
  id: string,
  workspaceId: string,
  input: UpdateExpenseInput
) {
  const set: Partial<typeof expenses.$inferInsert> = {
    ...input,
    updatedAt: new Date(),
  };

  // Keep taxTreatment, the legacy flag and the percent field in sync.
  let nextTreatment = input.taxTreatment;
  if (nextTreatment === undefined && input.isTaxDeductible !== undefined) {
    nextTreatment = input.isTaxDeductible ? "voll" : "nicht";
    set.taxTreatment = nextTreatment;
  }
  if (nextTreatment !== undefined) {
    set.isTaxDeductible = nextTreatment !== "nicht";
    set.deductiblePercent =
      nextTreatment === "teilweise"
        ? input.deductiblePercent ?? DEFAULT_PARTIAL_PERCENT
        : null;
  }

  // Transition into a numbered state: assign a Belegnummer once when the row
  // has none yet. Numbers are never cleared or reused.
  if (nextTreatment === "voll" || nextTreatment === "teilweise") {
    const [existing] = await db
      .select({
        receiptNumber: expenses.receiptNumber,
        operatingCompanyId: expenses.operatingCompanyId,
        dealRecordId: expenses.dealRecordId,
        date: expenses.date,
      })
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
      .limit(1);
    if (existing && existing.receiptNumber === null) {
      const companyId =
        input.operatingCompanyId ??
        existing.operatingCompanyId ??
        (existing.dealRecordId
          ? await resolveDealOperatingCompany(workspaceId, existing.dealRecordId)
          : null);
      const receiptNumber = await assignReceiptNumber(db, {
        workspaceId,
        operatingCompanyId: companyId,
        year: yearOfDate(input.date ?? existing.date),
        kind: "expense",
      });
      if (receiptNumber) set.receiptNumber = receiptNumber;
    }
  }

  const [row] = await db
    .update(expenses)
    .set(set)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}

// ─── Receipt getters (list payloads no longer ship base64) ───────────────────

/**
 * Fetch the receipt of a single booking row for the receipt route.
 * type "income" currently always returns null — payments have no receipt
 * column yet.
 */
export async function getBookingReceipt(
  workspaceId: string,
  type: "income" | "expense",
  id: string
): Promise<{ receiptFile: string; receiptName?: string | null } | null> {
  if (type === "income") return null;
  const [row] = await db
    .select({ receiptFile: expenses.receiptFile })
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .limit(1);
  return row?.receiptFile ? { receiptFile: row.receiptFile } : null;
}

/** Fetch the receipt of an employee_ledger entry for the receipt route. */
export async function getLedgerReceipt(
  workspaceId: string,
  entryId: string
): Promise<{ receiptFile: string; receiptName?: string | null } | null> {
  const [row] = await db
    .select({ receiptFile: employeeLedger.receiptFile })
    .from(employeeLedger)
    .where(
      and(
        eq(employeeLedger.id, entryId),
        eq(employeeLedger.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return row?.receiptFile ? { receiptFile: row.receiptFile } : null;
}

export async function deleteExpense(id: string, workspaceId: string) {
  const [row] = await db
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId)))
    .returning({ id: expenses.id });
  return row ?? null;
}

// ─── Company Bookings (deal-less income / expenses) ──────────────────────────
// Direct bookings against an operating company without a deal: Gemeinkosten
// (Miete, Versicherung, Software, ...) and Sonstige Erloese (Geraeteverkauf,
// Erstattungen Dritter). Stored in payments / expenses with dealRecordId NULL
// and the operatingCompanyId snapshot set.

export interface CompanyBookingInput {
  type: "income" | "expense";
  operatingCompanyId: string;
  date: string;
  amount: string;
  dealRecordId?: string | null;
  description?: string | null;
  /** Expense only. Defaults to "other". */
  category?: ExpenseCategory;
  /** Income only. */
  payer?: string | null;
  /** Expense only. */
  recipient?: string | null;
  paymentMethod?: string | null;
  /** Expense only. Legacy binary flag; ignored when taxTreatment is given. */
  isTaxDeductible?: boolean;
  /**
   * Steuerliche Behandlung. Income rows take an IncomeTaxTreatment (default
   * "betriebseinnahme"), expense rows an ExpenseTaxTreatment (default "voll",
   * bzw. "nicht" bei isTaxDeductible false).
   */
  taxTreatment?: ExpenseTaxTreatment | IncomeTaxTreatment;
  /** Expense only. Abzugsfaehiger Anteil in Prozent (nur bei "teilweise", default 70). */
  deductiblePercent?: number | null;
  /** Expense only (payments have no receipt column). Base64 data URL. */
  receiptFile?: string | null;
  /** Accepted for API compatibility; not persisted (no column yet). */
  receiptName?: string | null;
  notes?: string | null;
}

export interface CompanyBookingPatch {
  operatingCompanyId?: string;
  date?: string;
  amount?: string;
  description?: string | null;
  category?: ExpenseCategory;
  payer?: string | null;
  recipient?: string | null;
  paymentMethod?: string | null;
  /** Expense only. Legacy binary flag; ignored when taxTreatment is given. */
  isTaxDeductible?: boolean;
  /** See CompanyBookingInput.taxTreatment. */
  taxTreatment?: ExpenseTaxTreatment | IncomeTaxTreatment;
  /** Expense only. Nur bei "teilweise". */
  deductiblePercent?: number | null;
  receiptFile?: string | null;
  notes?: string | null;
}

/**
 * Create a deal-less booking for an operating company.
 *   - type "income"  → payments row (description is folded into notes, since
 *     payments has no description column).
 *   - type "expense" → expenses row (notes is folded into description, since
 *     expenses has no notes column).
 * Returns the inserted row.
 */
export async function createCompanyBooking(
  workspaceId: string,
  input: CompanyBookingInput
) {
  if (input.type === "income") {
    const notes =
      input.description && input.notes
        ? `${input.description} / ${input.notes}`
        : input.description ?? input.notes ?? null;
    const taxTreatment: IncomeTaxTreatment =
      input.taxTreatment === "nicht_steuerbar"
        ? "nicht_steuerbar"
        : "betriebseinnahme";
    const receiptNumber =
      taxTreatment === "betriebseinnahme"
        ? await assignReceiptNumber(db, {
            workspaceId,
            operatingCompanyId: input.operatingCompanyId,
            year: yearOfDate(input.date),
            kind: "income",
          })
        : null;
    const [row] = await db
      .insert(payments)
      .values({
        workspaceId,
        dealRecordId: input.dealRecordId ?? null,
        operatingCompanyId: input.operatingCompanyId,
        date: input.date,
        amount: input.amount,
        payer: input.payer ?? null,
        paymentMethod: input.paymentMethod ?? null,
        taxTreatment,
        receiptNumber,
        notes,
      })
      .returning();
    return row;
  }

  const description =
    input.description && input.notes
      ? `${input.description} / ${input.notes}`
      : input.description ?? input.notes ?? null;
  const taxTreatment: ExpenseTaxTreatment = isExpenseTreatment(
    input.taxTreatment
  )
    ? input.taxTreatment
    : input.isTaxDeductible === false
      ? "nicht"
      : "voll";
  const deductiblePercent =
    taxTreatment === "teilweise"
      ? input.deductiblePercent ?? DEFAULT_PARTIAL_PERCENT
      : null;
  const receiptNumber =
    taxTreatment !== "nicht"
      ? await assignReceiptNumber(db, {
          workspaceId,
          operatingCompanyId: input.operatingCompanyId,
          year: yearOfDate(input.date),
          kind: "expense",
        })
      : null;
  const [row] = await db
    .insert(expenses)
    .values({
      workspaceId,
      dealRecordId: input.dealRecordId ?? null,
      operatingCompanyId: input.operatingCompanyId,
      date: input.date,
      amount: input.amount,
      category: input.category ?? "other",
      description,
      recipient: input.recipient ?? null,
      paymentMethod: input.paymentMethod ?? null,
      // Legacy flag kept in sync until all readers are migrated.
      isTaxDeductible: taxTreatment !== "nicht",
      taxTreatment,
      deductiblePercent,
      receiptNumber,
      receiptFile: input.receiptFile ?? null,
    })
    .returning();
  return row;
}

/**
 * Update a deal-less booking. Scoped to rows with dealRecordId NULL so the
 * generic booking route can never mutate deal-bound rows. Returns the updated
 * row or null when no deal-less row matched.
 */
export async function updateCompanyBooking(
  id: string,
  type: "income" | "expense",
  workspaceId: string,
  patch: CompanyBookingPatch
) {
  if (type === "income") {
    const set: Partial<typeof payments.$inferInsert> = { updatedAt: new Date() };
    if (patch.date !== undefined) set.date = patch.date;
    if (patch.amount !== undefined) set.amount = patch.amount;
    if (patch.operatingCompanyId !== undefined)
      set.operatingCompanyId = patch.operatingCompanyId;
    if (patch.payer !== undefined) set.payer = patch.payer;
    if (patch.paymentMethod !== undefined) set.paymentMethod = patch.paymentMethod;
    if (patch.notes !== undefined || patch.description !== undefined)
      set.notes = patch.notes ?? patch.description ?? null;
    if (
      patch.taxTreatment === "betriebseinnahme" ||
      patch.taxTreatment === "nicht_steuerbar"
    )
      set.taxTreatment = patch.taxTreatment;

    // Transition into the numbered state: assign once, never clear or reuse.
    if (set.taxTreatment === "betriebseinnahme") {
      const [existing] = await db
        .select({
          receiptNumber: payments.receiptNumber,
          operatingCompanyId: payments.operatingCompanyId,
          date: payments.date,
        })
        .from(payments)
        .where(
          and(
            eq(payments.id, id),
            eq(payments.workspaceId, workspaceId),
            isNull(payments.dealRecordId)
          )
        )
        .limit(1);
      if (existing && existing.receiptNumber === null) {
        const receiptNumber = await assignReceiptNumber(db, {
          workspaceId,
          operatingCompanyId:
            patch.operatingCompanyId ?? existing.operatingCompanyId,
          year: yearOfDate(patch.date ?? existing.date),
          kind: "income",
        });
        if (receiptNumber) set.receiptNumber = receiptNumber;
      }
    }

    const [row] = await db
      .update(payments)
      .set(set)
      .where(
        and(
          eq(payments.id, id),
          eq(payments.workspaceId, workspaceId),
          isNull(payments.dealRecordId)
        )
      )
      .returning();
    return row ?? null;
  }

  const set: Partial<typeof expenses.$inferInsert> = { updatedAt: new Date() };
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.amount !== undefined) set.amount = patch.amount;
  if (patch.operatingCompanyId !== undefined)
    set.operatingCompanyId = patch.operatingCompanyId;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.description !== undefined || patch.notes !== undefined)
    set.description = patch.description ?? patch.notes ?? null;
  if (patch.recipient !== undefined) set.recipient = patch.recipient;
  if (patch.paymentMethod !== undefined) set.paymentMethod = patch.paymentMethod;
  if (patch.receiptFile !== undefined) set.receiptFile = patch.receiptFile;

  // Keep taxTreatment, the legacy flag and the percent field in sync.
  if (isExpenseTreatment(patch.taxTreatment)) {
    set.taxTreatment = patch.taxTreatment;
    set.isTaxDeductible = patch.taxTreatment !== "nicht";
    set.deductiblePercent =
      patch.taxTreatment === "teilweise"
        ? patch.deductiblePercent ?? DEFAULT_PARTIAL_PERCENT
        : null;
  } else if (patch.isTaxDeductible !== undefined) {
    set.isTaxDeductible = patch.isTaxDeductible;
    set.taxTreatment = patch.isTaxDeductible ? "voll" : "nicht";
    if (!patch.isTaxDeductible) set.deductiblePercent = null;
  } else if (patch.deductiblePercent !== undefined) {
    set.deductiblePercent = patch.deductiblePercent;
  }

  // Transition into a numbered state: assign once, never clear or reuse.
  if (set.taxTreatment === "voll" || set.taxTreatment === "teilweise") {
    const [existing] = await db
      .select({
        receiptNumber: expenses.receiptNumber,
        operatingCompanyId: expenses.operatingCompanyId,
        date: expenses.date,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.workspaceId, workspaceId),
          isNull(expenses.dealRecordId)
        )
      )
      .limit(1);
    if (existing && existing.receiptNumber === null) {
      const receiptNumber = await assignReceiptNumber(db, {
        workspaceId,
        operatingCompanyId:
          patch.operatingCompanyId ?? existing.operatingCompanyId,
        year: yearOfDate(patch.date ?? existing.date),
        kind: "expense",
      });
      if (receiptNumber) set.receiptNumber = receiptNumber;
    }
  }

  const [row] = await db
    .update(expenses)
    .set(set)
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.workspaceId, workspaceId),
        isNull(expenses.dealRecordId)
      )
    )
    .returning();
  return row ?? null;
}

/**
 * Delete a deal-less booking. Scoped to rows with dealRecordId NULL.
 * Returns { id } or null when no deal-less row matched.
 */
export async function deleteCompanyBooking(
  id: string,
  type: "income" | "expense",
  workspaceId: string
) {
  if (type === "income") {
    const [row] = await db
      .delete(payments)
      .where(
        and(
          eq(payments.id, id),
          eq(payments.workspaceId, workspaceId),
          isNull(payments.dealRecordId)
        )
      )
      .returning({ id: payments.id });
    return row ?? null;
  }
  const [row] = await db
    .delete(expenses)
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.workspaceId, workspaceId),
        isNull(expenses.dealRecordId)
      )
    )
    .returning({ id: expenses.id });
  return row ?? null;
}

export interface CompanyBookingListRow {
  id: string;
  type: "income" | "expense";
  date: string;
  amount: number;
  /** Expense only; null for income rows. */
  category: string | null;
  taxTreatment: string;
  /** Expense only; null unless taxTreatment "teilweise". */
  deductiblePercent: number | null;
  receiptNumber: string | null;
  hasReceipt: boolean;
  /** Income: payer ?? notes. Expense: description ?? recipient. */
  summary: string | null;
  dealRecordId: string | null;
  dealName: string | null;
  operatingCompanyId: string | null;
  operatingCompanyName: string;
}

/**
 * Merged recent bookings (payments + expenses, deal-bound AND deal-less),
 * sorted by date desc then createdAt desc, limited to 100 rows. Company
 * attribution mirrors the overview: snapshot first, then the deal's live
 * operating company.
 */
export async function listCompanyBookings(
  workspaceId: string,
  opts: {
    month?: string | null;
    type?: "income" | "expense";
    operatingCompanyId?: string | null;
  } = {}
): Promise<CompanyBookingListRow[]> {
  const range = parseMonth(opts.month ?? null);
  const LIMIT = 100;
  // Fetch more than the final limit per table so the company filter (resolved
  // in JS for legacy rows without a snapshot) still has enough rows.
  const FETCH_LIMIT = 500;

  const paymentDateCond = range
    ? and(gte(payments.date, range.start), lt(payments.date, range.end))
    : undefined;
  const expenseDateCond = range
    ? and(gte(expenses.date, range.start), lt(expenses.date, range.end))
    : undefined;

  const incomeRows =
    opts.type === "expense"
      ? []
      : await db
          .select({
            id: payments.id,
            dealRecordId: payments.dealRecordId,
            operatingCompanyId: payments.operatingCompanyId,
            date: payments.date,
            amount: payments.amount,
            payer: payments.payer,
            notes: payments.notes,
            taxTreatment: payments.taxTreatment,
            receiptNumber: payments.receiptNumber,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .where(and(eq(payments.workspaceId, workspaceId), paymentDateCond))
          .orderBy(desc(payments.date), desc(payments.createdAt))
          .limit(FETCH_LIMIT);

  const expenseRows =
    opts.type === "income"
      ? []
      : await db
          .select({
            id: expenses.id,
            dealRecordId: expenses.dealRecordId,
            operatingCompanyId: expenses.operatingCompanyId,
            date: expenses.date,
            amount: expenses.amount,
            category: expenses.category,
            description: expenses.description,
            recipient: expenses.recipient,
            taxTreatment: expenses.taxTreatment,
            deductiblePercent: expenses.deductiblePercent,
            receiptNumber: expenses.receiptNumber,
            hasReceipt: sql<boolean>`(${expenses.receiptFile} IS NOT NULL OR ${expenses.receiptJobMediaId} IS NOT NULL)`,
            createdAt: expenses.createdAt,
          })
          .from(expenses)
          .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond))
          .orderBy(desc(expenses.date), desc(expenses.createdAt))
          .limit(FETCH_LIMIT);

  // Deal → operating_company lookup (legacy rows without snapshot).
  const dealIds = [
    ...new Set(
      [
        ...incomeRows.map((r) => r.dealRecordId),
        ...expenseRows.map((r) => r.dealRecordId),
      ].filter((id): id is string => !!id)
    ),
  ];
  const dealCompanyLookup = new Map<string, string | null>();
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

  const resolveCompany = (row: {
    operatingCompanyId: string | null;
    dealRecordId: string | null;
  }): string | null =>
    row.operatingCompanyId ??
    (row.dealRecordId ? dealCompanyLookup.get(row.dealRecordId) ?? null : null);

  type Candidate = Omit<
    CompanyBookingListRow,
    "dealName" | "operatingCompanyName"
  > & { createdAt: Date };

  const candidates: Candidate[] = [
    ...incomeRows.map(
      (r): Candidate => ({
        id: r.id,
        type: "income",
        date: r.date,
        amount: Number(r.amount),
        category: null,
        taxTreatment: r.taxTreatment,
        deductiblePercent: null,
        receiptNumber: r.receiptNumber,
        hasReceipt: false,
        summary: r.payer ?? r.notes ?? null,
        dealRecordId: r.dealRecordId,
        operatingCompanyId: resolveCompany(r),
        createdAt: r.createdAt,
      })
    ),
    ...expenseRows.map(
      (r): Candidate => ({
        id: r.id,
        type: "expense",
        date: r.date,
        amount: Number(r.amount),
        category: r.category,
        taxTreatment: r.taxTreatment,
        deductiblePercent: r.deductiblePercent,
        receiptNumber: r.receiptNumber,
        hasReceipt: r.hasReceipt,
        summary: r.description ?? r.recipient ?? null,
        dealRecordId: r.dealRecordId,
        operatingCompanyId: resolveCompany(r),
        createdAt: r.createdAt,
      })
    ),
  ];

  const filtered =
    opts.operatingCompanyId !== undefined && opts.operatingCompanyId !== null
      ? candidates.filter(
          (c) => c.operatingCompanyId === opts.operatingCompanyId
        )
      : candidates;

  const top = filtered
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    .slice(0, LIMIT);

  // Name lookups only for the rows we actually return.
  const topDealIds = [
    ...new Set(top.map((c) => c.dealRecordId).filter((id): id is string => !!id)),
  ];
  const dealNameLookup = new Map<string, string>();
  if (topDealIds.length) {
    const rows = await db.execute(
      sql`SELECT rv.record_id, rv.text_value FROM record_values rv INNER JOIN attributes a ON a.id = rv.attribute_id WHERE a.slug = 'name' AND rv.record_id = ANY(ARRAY[${sql.join(topDealIds.map((id) => sql`${id}`), sql`, `)}]::text[])`
    );
    for (const r of rows as unknown as Array<{
      record_id: string;
      text_value: string;
    }>) {
      dealNameLookup.set(r.record_id, r.text_value);
    }
  }

  const companyIds = [
    ...new Set(
      top.map((c) => c.operatingCompanyId).filter((id): id is string => !!id)
    ),
  ];
  const companyNames = new Map<string, string>();
  if (companyIds.length) {
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
      const nameRows = await db
        .select({ recordId: recordValues.recordId, name: recordValues.textValue })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, nameAttr.id),
            sql`${recordValues.recordId} = ANY(ARRAY[${sql.join(companyIds.map((id) => sql`${id}`), sql`, `)}]::text[])`
          )
        );
      for (const r of nameRows) companyNames.set(r.recordId, r.name ?? "Unbekannt");
    }
  }

  return top.map(({ createdAt: _createdAt, ...c }) => ({
    ...c,
    dealName: c.dealRecordId
      ? dealNameLookup.get(c.dealRecordId) ?? "Unbekannt"
      : null,
    operatingCompanyName: c.operatingCompanyId
      ? companyNames.get(c.operatingCompanyId) ?? "Unbekannt"
      : "Nicht zugewiesen",
  }));
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
      // Base64 stays out of list payloads — fetch via getLedgerReceipt.
      hasReceipt: sql<boolean>`(${employeeLedger.receiptFile} IS NOT NULL)`,
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
        // Earnings + reimbursements + in-kind purchases count as labour cost.
        // `payment` rows are mere settlements of an already-recognised cost.
        inArray(employeeLedger.kind, COST_LEDGER_KINDS)
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
        inArray(employeeLedger.kind, COST_LEDGER_KINDS)
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
  /** Betriebsergebnis: income - expenses - employeeCosts. No private movements, no cross-subsidy credit. */
  netResult: number;
  /** Kassenstand des Firmentopfs: netResult + privateEinlagen - privateEntnahmen. */
  kassenstand: number;
}

/**
 * Workspace-level financial overview, optionally filtered by month ("YYYY-MM").
 *
 * Per-company attribution rules:
 *   - Base company per row: the `operating_company_id` snapshot written at
 *     booking time, falling back to the deal's live operating_company for
 *     legacy rows, else "Nicht zugewiesen".
 *   - Income: attributed to the base company.
 *   - Expense / employee-tx: attributed to `paying_operating_company_id` if
 *     set, otherwise to the base company. If the payer differs from the base
 *     company the row counts as a cross-subsidy (Quersubvention); crossIn/Out
 *     are pure transparency fields and never enter netResult.
 *   - Private transactions: equity movements. They never enter netResult /
 *     netProfit; they only move the kassenstand.
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
      operatingCompanyId: payments.operatingCompanyId,
      amount: payments.amount,
    })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), paymentDateCond));

  const expenseRows = await db
    .select({
      dealRecordId: expenses.dealRecordId,
      operatingCompanyId: expenses.operatingCompanyId,
      amount: expenses.amount,
      category: expenses.category,
      taxTreatment: expenses.taxTreatment,
      deductiblePercent: expenses.deductiblePercent,
      payingOperatingCompanyId: expenses.payingOperatingCompanyId,
    })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond));

  // Employee labour cost = earnings + reimbursements + in-kind purchases
  // (owner decision 2026-06-12). `payment` rows merely settle an
  // already-recognised cost and stay excluded.
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
        inArray(employeeLedger.kind, COST_LEDGER_KINDS),
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

  // Collect every op_company we actually see (deals + snapshots + payingOp overrides + private)
  const touchedCompanyIds = new Set<string>();
  for (const id of dealCompanyLookup.values()) if (id) touchedCompanyIds.add(id);
  for (const r of paymentRows) if (r.operatingCompanyId) touchedCompanyIds.add(r.operatingCompanyId);
  for (const r of expenseRows) {
    if (r.payingOperatingCompanyId) touchedCompanyIds.add(r.payingOperatingCompanyId);
    if (r.operatingCompanyId) touchedCompanyIds.add(r.operatingCompanyId);
  }
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
  const blankRow = (): Omit<CompanyBreakdownRow, "companyId" | "companyName" | "netResult" | "kassenstand"> => ({
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

  // Base company per row: snapshot first, then the deal's live owner.
  const baseCompany = (row: {
    operatingCompanyId: string | null;
    dealRecordId: string | null;
  }): string | null =>
    row.operatingCompanyId ??
    (row.dealRecordId ? dealCompanyLookup.get(row.dealRecordId) ?? null : null);

  // Income → base company
  for (const p of paymentRows) {
    bump(baseCompany(p)).income += Number(p.amount);
  }

  // Expenses → effective payer; cross-subsidy bookkeeping
  for (const e of expenseRows) {
    const baseOp = baseCompany(e);
    const effectivePayer = e.payingOperatingCompanyId ?? baseOp;
    const amt = Number(e.amount);
    const isCross =
      e.payingOperatingCompanyId !== null &&
      baseOp !== null &&
      e.payingOperatingCompanyId !== baseOp;

    const r = bump(effectivePayer);
    // taxTreatment split: "teilweise" rows contribute their deductible share
    // and push the remainder into nonDeductibleExpenses.
    const split = splitExpenseAmount(amt, e.taxTreatment, e.deductiblePercent);
    r.deductibleExpenses += split.deductible;
    r.nonDeductibleExpenses += split.nonDeductible;
    if (isCross) r.crossSubsidyOut += amt;

    // The beneficiary company got its expense paid by someone else.
    if (isCross && baseOp) {
      bump(baseOp).crossSubsidyIn += amt;
    }
  }

  // Employee costs → same rules (snapshot first, then deal owner).
  for (const t of empTxRows) {
    const baseOp = baseCompany(t);
    const effectivePayer = t.payingOperatingCompanyId ?? baseOp;
    const amt = Number(t.amount);
    const isCross =
      t.payingOperatingCompanyId !== null &&
      baseOp !== null &&
      t.payingOperatingCompanyId !== baseOp;

    const r = bump(effectivePayer);
    r.employeeCosts += amt;
    if (isCross) r.crossSubsidyOut += amt;
    if (isCross && baseOp) bump(baseOp).crossSubsidyIn += amt;
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
      // Betriebsergebnis (operating result):
      //   income - deductible - nonDeductible - employeeCosts
      //
      // crossSubsidyIn/Out are pure transparency fields: expenses attributed
      // via effectivePayer already contain the crossOut amount in
      // deductible/nonDeductible, and crediting crossIn here would
      // double-count the subsidy in the 50/50 settlement.
      // Private Einlagen/Entnahmen are equity movements and only affect the
      // kassenstand, never the operating result.
      const netResult =
        r.income -
        r.deductibleExpenses -
        r.nonDeductibleExpenses -
        r.employeeCosts;
      const kassenstand = netResult + r.privateEinlagen - r.privateEntnahmen;
      return {
        companyId,
        companyName,
        ...r,
        netResult,
        kassenstand,
      };
    }
  ).sort((a, b) => b.income - a.income);

  // ── Per-deal breakdown (unchanged shape; used by DealsTable) ──────────────
  const dealMap = new Map<string, { income: number; expenses: number; empCosts: number }>();
  for (const p of paymentRows) {
    if (!p.dealRecordId) continue; // deal-less bookings are not part of a deal row
    const d = dealMap.get(p.dealRecordId) ?? { income: 0, expenses: 0, empCosts: 0 };
    d.income += Number(p.amount);
    dealMap.set(p.dealRecordId, d);
  }
  for (const e of expenseRows) {
    if (!e.dealRecordId) continue; // deal-less bookings are not part of a deal row
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
  let totalDeductibleExpenses = 0;
  let totalNonDeductibleExpenses = 0;
  for (const e of expenseRows) {
    const split = splitExpenseAmount(
      Number(e.amount),
      e.taxTreatment,
      e.deductiblePercent
    );
    totalDeductibleExpenses += split.deductible;
    totalNonDeductibleExpenses += split.nonDeductible;
  }
  const totalExpenses = totalDeductibleExpenses + totalNonDeductibleExpenses;
  const totalEmployeeCosts = empTxRows.reduce((s, t) => s + Number(t.amount), 0);
  const totalPrivateEinlagen = privateRows
    .filter((p) => p.direction === "einlage")
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalPrivateEntnahmen = privateRows
    .filter((p) => p.direction === "entnahme")
    .reduce((s, p) => s + Number(p.amount), 0);

  // Betriebsergebnis: private Einlagen/Entnahmen are equity movements and
  // stay out of profit and margin. They only move the kassenstand.
  const netProfit = totalIncome - totalExpenses - totalEmployeeCosts;
  const totalKassenstand =
    netProfit + totalPrivateEinlagen - totalPrivateEntnahmen;

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
      totalKassenstand,
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
    /** Betriebsergebnis: income - expenses - employeeCosts. No private movements, no cross-subsidy credit. */
    netResult: number;
    /** Kassenstand des Firmentopfs: netResult + privateEinlagen - privateEntnahmen. */
    kassenstand: number;
  };
  /**
   * Income grouped by deal (one slice per deal in the income pie chart).
   * Deal-less bookings are grouped into one bucket with dealRecordId "" and
   * dealName "Ohne Auftrag".
   */
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
      taxTreatment: string;
      receiptNumber: string | null;
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
    /** Legacy flag, kept in sync with taxTreatment (false only when "nicht"). */
    isTaxDeductible: boolean;
    taxTreatment: string;
    deductiblePercent: number | null;
    receiptNumber: string | null;
    hasReceipt: boolean;
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
    type: "earning" | "reimbursement" | "payment" | "in_kind";
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

  // Explicit select keeps the receiptFile base64 out of the query result.
  const expenseRows = await db
    .select({
      id: expenses.id,
      dealRecordId: expenses.dealRecordId,
      operatingCompanyId: expenses.operatingCompanyId,
      date: expenses.date,
      amount: expenses.amount,
      category: expenses.category,
      description: expenses.description,
      recipient: expenses.recipient,
      paymentMethod: expenses.paymentMethod,
      isTaxDeductible: expenses.isTaxDeductible,
      taxTreatment: expenses.taxTreatment,
      deductiblePercent: expenses.deductiblePercent,
      receiptNumber: expenses.receiptNumber,
      payingOperatingCompanyId: expenses.payingOperatingCompanyId,
      hasReceipt: sql<boolean>`(${expenses.receiptFile} IS NOT NULL OR ${expenses.receiptJobMediaId} IS NOT NULL)`,
    })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), expenseDateCond));

  // Labour cost rows: earnings + reimbursements + in-kind purchases
  // (owner decision 2026-06-12). `payment` rows stay excluded.
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
        inArray(employeeLedger.kind, COST_LEDGER_KINDS),
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
  for (const r of paymentRows)
    if (r.operatingCompanyId) touchedCompanyIds.add(r.operatingCompanyId);
  for (const r of expenseRows) {
    if (r.payingOperatingCompanyId)
      touchedCompanyIds.add(r.payingOperatingCompanyId);
    if (r.operatingCompanyId) touchedCompanyIds.add(r.operatingCompanyId);
  }
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

  // Base company per row: snapshot first, then the deal's live owner.
  const baseCompany = (row: {
    operatingCompanyId: string | null;
    dealRecordId: string | null;
  }): string | null =>
    row.operatingCompanyId ??
    (row.dealRecordId ? dealCompanyLookup.get(row.dealRecordId) ?? null : null);

  // ── Income (payments) → attributed to base company ────────────────────────
  // Deal-less bookings share one bucket keyed "".
  const incomePaymentsByDeal = new Map<
    string,
    { total: number; payments: CompanyDetails["incomeByDeal"][number]["payments"] }
  >();
  for (const p of paymentRows) {
    if (baseCompany(p) !== companyId) continue;
    const key = p.dealRecordId ?? "";
    let bucket = incomePaymentsByDeal.get(key);
    if (!bucket) {
      bucket = { total: 0, payments: [] };
      incomePaymentsByDeal.set(key, bucket);
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
      taxTreatment: p.taxTreatment,
      receiptNumber: p.receiptNumber,
    });
  }

  const incomeByDeal: CompanyDetails["incomeByDeal"] = [
    ...incomePaymentsByDeal.entries(),
  ]
    .map(([dealRecordId, b]) => ({
      dealRecordId,
      dealNumber: dealRecordId ? dealNumberLookup.get(dealRecordId) ?? "—" : "—",
      dealName: dealRecordId
        ? dealNameLookup.get(dealRecordId) ?? "Unbekannt"
        : "Ohne Auftrag",
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
    const baseOp = baseCompany(e);
    const effectivePayer = e.payingOperatingCompanyId ?? baseOp;
    const isCross =
      e.payingOperatingCompanyId !== null &&
      baseOp !== null &&
      e.payingOperatingCompanyId !== baseOp;
    const amt = Number(e.amount);
    const dealNumber = e.dealRecordId
      ? dealNumberLookup.get(e.dealRecordId) ?? "—"
      : "—";
    const dealName = e.dealRecordId
      ? dealNameLookup.get(e.dealRecordId) ?? "Unbekannt"
      : "Ohne Auftrag";

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
        taxTreatment: e.taxTreatment,
        deductiblePercent: e.deductiblePercent,
        receiptNumber: e.receiptNumber,
        hasReceipt: e.hasReceipt,
        isCrossSubsidy: isCross,
        dealRecordId: e.dealRecordId ?? "",
        dealNumber,
        dealName,
      });
      const split = splitExpenseAmount(amt, e.taxTreatment, e.deductiblePercent);
      totalDeductible += split.deductible;
      totalNonDeductible += split.nonDeductible;
      if (isCross) totalCrossOut += amt;
    }

    // Cross-subsidy IN: this company's booking, but someone else paid.
    if (isCross && baseOp === companyId) {
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
        dealRecordId: e.dealRecordId ?? "",
        dealNumber,
        dealName,
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
    const split = splitExpenseAmount(
      e.amount,
      e.taxTreatment,
      e.deductiblePercent
    );
    row.deductibleTotal += split.deductible;
    row.nonDeductibleTotal += split.nonDeductible;
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
    const baseOp = baseCompany(t);
    const effectivePayer = t.payingOperatingCompanyId ?? baseOp;
    const isCross =
      t.payingOperatingCompanyId !== null &&
      baseOp !== null &&
      t.payingOperatingCompanyId !== baseOp;
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

    if (isCross && baseOp === companyId) {
      totalCrossIn += amt;
      crossSubsidyInEntries.push({
        id: t.id,
        kind: "employee",
        date: t.date,
        amount: amt,
        label: `${t.employeeName} (${LEDGER_KIND_LABEL[t.kind] ?? t.kind})`,
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

  // ── Compose totals (mirror getFinancialOverview's formulas) ──────────────
  const totalIncome = incomeByDeal.reduce((s, d) => s + d.total, 0);
  // Betriebsergebnis: no cross-subsidy credit, no private movements.
  const netResult =
    totalIncome - totalDeductible - totalNonDeductible - totalEmployeeCosts;
  const kassenstand = netResult + totalEinlagen - totalEntnahmen;

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
      kassenstand,
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
const LEDGER_KIND_LABEL: Record<string, string> = {
  earning: "Verdienst",
  reimbursement: "Auslage",
  payment: "Auszahlung",
  in_kind: "Sachbezug",
};

const CATEGORY_LABEL_FALLBACK: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label])
);
