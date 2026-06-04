import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listDealEmployeeLedger, createEmployeeLedgerEntry } from "@/services/financial";

const VALID_KINDS = ["earning", "reimbursement", "payment", "in_kind"] as const;
const VALID_METHODS = ["cash", "bank_transfer", "other"] as const;
type PaymentMethod = typeof VALID_METHODS[number];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listDealEmployeeLedger(recordId);
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
    employeeId,
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

  if (!employeeId) return badRequest("employeeId is required");
  if (!date || !amount) return badRequest("date and amount are required");
  if (!kind || !VALID_KINDS.includes(kind)) {
    return badRequest(`kind must be one of: ${VALID_KINDS.join(", ")}`);
  }
  if (paymentMethod && !VALID_METHODS.includes(paymentMethod)) {
    return badRequest(`paymentMethod must be one of: ${VALID_METHODS.join(", ")}`);
  }

  const row = await createEmployeeLedgerEntry(ctx.workspaceId, {
    employeeId,
    dealRecordId: recordId,
    date,
    kind,
    amount: String(amount),
    description,
    notes,
    paymentMethod: (paymentMethod as PaymentMethod | undefined) ?? null,
    isTaxDeductible: typeof isTaxDeductible === "boolean" ? isTaxDeductible : undefined,
    payingOperatingCompanyId: payingOperatingCompanyId ?? null,
    operatingCompanyId: operatingCompanyId ?? null,
    dueDate: dueDate ?? null,
    receiptFile: receiptFile ?? null,
  });
  return success(row, 201);
}
