import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateEmployeeTransaction, deleteEmployeeTransaction } from "@/services/financial";

const VALID_TYPES = ["salary", "advance", "reimbursement"] as const;
const VALID_STATUSES = ["open", "paid"] as const;
const VALID_METHODS = ["cash", "bank_transfer", "other"] as const;
type PaymentMethod = typeof VALID_METHODS[number];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; transactionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { transactionId } = await params;
  const body = await req.json();
  const {
    date,
    type,
    amount,
    status,
    description,
    notes,
    paymentMethod,
    isTaxDeductible,
    payingOperatingCompanyId,
    receiptFile,
  } = body;

  if (type && !VALID_TYPES.includes(type)) {
    return badRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  if (paymentMethod && paymentMethod !== null && !VALID_METHODS.includes(paymentMethod)) {
    return badRequest(`paymentMethod must be one of: ${VALID_METHODS.join(", ")}`);
  }

  const row = await updateEmployeeTransaction(transactionId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(type !== undefined && { type }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(status !== undefined && { status }),
    ...(description !== undefined && { description }),
    ...(notes !== undefined && { notes }),
    ...(paymentMethod !== undefined && { paymentMethod: (paymentMethod || null) as PaymentMethod | null }),
    ...(isTaxDeductible !== undefined && { isTaxDeductible }),
    ...(payingOperatingCompanyId !== undefined && { payingOperatingCompanyId: payingOperatingCompanyId || null }),
    ...(receiptFile !== undefined && { receiptFile: receiptFile || null }),
  });
  if (!row) return notFound("Transaction not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; transactionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { transactionId } = await params;
  const row = await deleteEmployeeTransaction(transactionId, ctx.workspaceId);
  if (!row) return notFound("Transaction not found");
  return success({ deleted: true });
}
