import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateEmployeeLedgerEntry, deleteEmployeeLedgerEntry } from "@/services/financial";

const VALID_KINDS = ["earning", "reimbursement", "payment", "in_kind"] as const;
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
    kind,
    amount,
    description,
    notes,
    paymentMethod,
    isTaxDeductible,
    payingOperatingCompanyId,
    operatingCompanyId,
    dueDate,
    receiptFile,
  } = body;

  if (kind && !VALID_KINDS.includes(kind)) {
    return badRequest(`kind must be one of: ${VALID_KINDS.join(", ")}`);
  }
  if (paymentMethod && paymentMethod !== null && !VALID_METHODS.includes(paymentMethod)) {
    return badRequest(`paymentMethod must be one of: ${VALID_METHODS.join(", ")}`);
  }

  const row = await updateEmployeeLedgerEntry(transactionId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(kind !== undefined && { kind }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(description !== undefined && { description: description || null }),
    ...(notes !== undefined && { notes: notes || null }),
    ...(paymentMethod !== undefined && { paymentMethod: (paymentMethod || null) as PaymentMethod | null }),
    ...(isTaxDeductible !== undefined && { isTaxDeductible }),
    ...(payingOperatingCompanyId !== undefined && { payingOperatingCompanyId: payingOperatingCompanyId || null }),
    ...(operatingCompanyId !== undefined && { operatingCompanyId: operatingCompanyId || null }),
    ...(dueDate !== undefined && { dueDate: dueDate || null }),
    ...(receiptFile !== undefined && { receiptFile: receiptFile || null }),
  });
  if (!row) return notFound("Ledger entry not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; transactionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { transactionId } = await params;
  const row = await deleteEmployeeLedgerEntry(transactionId, ctx.workspaceId);
  if (!row) return notFound("Ledger entry not found");
  return success({ deleted: true });
}
