import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import {
  listExpenses,
  createExpense,
  resolveDealOperatingCompany,
} from "@/services/financial";

const VALID_CATEGORIES = ["fuel", "truck_rental", "equipment", "subcontractor", "toll", "other"] as const;
type Category = typeof VALID_CATEGORIES[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

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
    payingOperatingCompanyId,
  } = body;

  if (!date || !amount) return badRequest("date and amount are required");
  if (!isValidDate(date)) return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  if (!isValidAmount(amount)) return badRequest("Betrag muss größer 0 sein");
  if (category && !VALID_CATEGORIES.includes(category)) {
    return badRequest(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  // Snapshot the deal's operating company at booking time (Phase 0 Punkt 5).
  const operatingCompanyId = await resolveDealOperatingCompany(
    ctx.workspaceId,
    recordId
  );

  const row = await createExpense(ctx.workspaceId, recordId, {
    date,
    amount: String(amount),
    category: (category as Category) ?? "other",
    description,
    recipient,
    paymentMethod,
    receiptFile,
    isTaxDeductible: typeof isTaxDeductible === "boolean" ? isTaxDeductible : undefined,
    payingOperatingCompanyId: payingOperatingCompanyId ?? null,
    operatingCompanyId,
  });
  return success(row, 201);
}
