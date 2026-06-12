import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateExpense, deleteExpense, type ExpenseCategory } from "@/services/financial";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";

const CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value);
type Category = ExpenseCategory;

const EXPENSE_TREATMENTS = ["voll", "teilweise", "nicht"] as const;
type ExpenseTreatment = (typeof EXPENSE_TREATMENTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isValidPercent = (v: unknown) =>
  (typeof v === "number" || typeof v === "string") &&
  Number.isInteger(Number(v)) &&
  Number(v) >= 1 &&
  Number(v) <= 99;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; expenseId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { expenseId } = await params;
  const body = await req.json();
  const {
    date,
    amount,
    category,
    description,
    recipient,
    paymentMethod,
    receiptFile,
    isTaxDeductible,
    taxTreatment,
    deductiblePercent,
    payingOperatingCompanyId,
  } = body;

  if (date !== undefined && !isValidDate(date)) {
    return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  }
  if (amount !== undefined && !isValidAmount(amount)) {
    return badRequest("Betrag muss größer 0 sein");
  }
  if (category && !CATEGORY_VALUES.includes(category)) {
    return badRequest(`category must be one of: ${CATEGORY_VALUES.join(", ")}`);
  }

  // --- Steuerliche Behandlung ------------------------------------------
  let resolvedTreatment: ExpenseTreatment | undefined;
  let resolvedPercent: number | undefined;
  if (taxTreatment !== undefined && taxTreatment !== null) {
    if (!EXPENSE_TREATMENTS.includes(taxTreatment)) {
      return badRequest("taxTreatment muss voll, teilweise oder nicht sein");
    }
    resolvedTreatment = taxTreatment;
  } else if (typeof isTaxDeductible === "boolean") {
    // Legacy-Clients senden noch isTaxDeductible statt taxTreatment.
    resolvedTreatment = isTaxDeductible ? "voll" : "nicht";
  }
  if (deductiblePercent !== undefined && deductiblePercent !== null) {
    if (!isValidPercent(deductiblePercent)) {
      return badRequest("deductiblePercent muss eine ganze Zahl zwischen 1 und 99 sein");
    }
    if (resolvedTreatment !== "teilweise") {
      return badRequest("deductiblePercent ist nur bei taxTreatment teilweise erlaubt");
    }
    resolvedPercent = Number(deductiblePercent);
  }
  if (resolvedTreatment === "teilweise" && resolvedPercent === undefined) {
    resolvedPercent = 70;
  }
  // Bußgelder sind nie abziehbar (serverseitige Regel).
  if (category === "fines") {
    resolvedTreatment = "nicht";
    resolvedPercent = undefined;
  }

  const row = await updateExpense(expenseId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(category !== undefined && { category: category as Category }),
    ...(description !== undefined && { description }),
    ...(recipient !== undefined && { recipient }),
    ...(paymentMethod !== undefined && { paymentMethod }),
    ...(receiptFile !== undefined && { receiptFile }),
    ...(resolvedTreatment !== undefined && { taxTreatment: resolvedTreatment }),
    ...(resolvedPercent !== undefined && { deductiblePercent: resolvedPercent }),
    ...(payingOperatingCompanyId !== undefined && {
      payingOperatingCompanyId: payingOperatingCompanyId || null,
    }),
  });
  if (!row) return notFound("Expense not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; expenseId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { expenseId } = await params;
  const row = await deleteExpense(expenseId, ctx.workspaceId);
  if (!row) return notFound("Expense not found");
  return success({ deleted: true });
}
