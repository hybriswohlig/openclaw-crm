import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateExpense, deleteExpense } from "@/services/financial";

const VALID_CATEGORIES = ["fuel", "truck_rental", "equipment", "subcontractor", "toll", "other"] as const;
type Category = typeof VALID_CATEGORIES[number];

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
    payingOperatingCompanyId,
  } = body;

  if (category && !VALID_CATEGORIES.includes(category)) {
    return badRequest(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  const row = await updateExpense(expenseId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(category !== undefined && { category: category as Category }),
    ...(description !== undefined && { description }),
    ...(recipient !== undefined && { recipient }),
    ...(paymentMethod !== undefined && { paymentMethod }),
    ...(receiptFile !== undefined && { receiptFile }),
    ...(isTaxDeductible !== undefined && { isTaxDeductible }),
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
