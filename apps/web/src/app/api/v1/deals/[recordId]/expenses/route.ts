import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import {
  listExpenses,
  createExpense,
  resolveDealOperatingCompany,
  type ExpenseCategory,
} from "@/services/financial";
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listExpenses(recordId);
  return success(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
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

  if (!date || !amount) return badRequest("date and amount are required");
  if (!isValidDate(date)) return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  if (!isValidAmount(amount)) return badRequest("Betrag muss größer 0 sein");
  if (category && !CATEGORY_VALUES.includes(category)) {
    return badRequest(`category must be one of: ${CATEGORY_VALUES.join(", ")}`);
  }

  // --- Steuerliche Behandlung ------------------------------------------
  let resolvedTreatment: ExpenseTreatment | undefined;
  let resolvedPercent: number | undefined;
  if (taxTreatment != null) {
    if (!EXPENSE_TREATMENTS.includes(taxTreatment)) {
      return badRequest("taxTreatment muss voll, teilweise oder nicht sein");
    }
    resolvedTreatment = taxTreatment;
  } else if (typeof isTaxDeductible === "boolean") {
    // Legacy-Clients senden noch isTaxDeductible statt taxTreatment.
    resolvedTreatment = isTaxDeductible ? "voll" : "nicht";
  }
  if (deductiblePercent != null) {
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
  const effectiveCategory: Category = (category as Category) ?? "other";
  if (effectiveCategory === "fines") {
    resolvedTreatment = "nicht";
    resolvedPercent = undefined;
  }

  // Snapshot the deal's operating company at booking time (Phase 0 Punkt 5).
  const operatingCompanyId = await resolveDealOperatingCompany(
    ctx.workspaceId,
    recordId
  );

  const row = await createExpense(ctx.workspaceId, recordId, {
    date,
    amount: String(amount),
    category: effectiveCategory,
    description,
    recipient,
    paymentMethod,
    receiptFile,
    ...(resolvedTreatment !== undefined && { taxTreatment: resolvedTreatment }),
    ...(resolvedPercent !== undefined && { deductiblePercent: resolvedPercent }),
    payingOperatingCompanyId: payingOperatingCompanyId ?? null,
    operatingCompanyId,
  });
  return success(row, 201);
}
