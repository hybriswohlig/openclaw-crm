import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, notFound, success } from "@/lib/api-utils";
import { createEmployeeLedgerEntry } from "@/services/financial";
import { getEmployee } from "@/services/employees";

const VALID_KINDS = ["earning", "reimbursement", "payment", "in_kind"] as const;
const VALID_METHODS = ["cash", "bank_transfer", "other"] as const;
type PaymentMethod = typeof VALID_METHODS[number];

/**
 * Create a ledger entry for an employee (earning / reimbursement / payment).
 * Used by the Mitarbeiter overview to record free payments and manual credits.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { employeeId } = await params;
  const emp = await getEmployee(ctx.workspaceId, employeeId);
  if (!emp) return notFound("Employee not found");

  const body = await req.json();
  const {
    date,
    kind,
    amount,
    operatingCompanyId,
    payingOperatingCompanyId,
    dealRecordId,
    paymentMethod,
    description,
    notes,
    isTaxDeductible,
    dueDate,
    receiptFile,
  } = body;

  if (!date || !amount) return badRequest("date and amount are required");
  if (!kind || !VALID_KINDS.includes(kind)) {
    return badRequest(`kind must be one of: ${VALID_KINDS.join(", ")}`);
  }
  if (paymentMethod && !VALID_METHODS.includes(paymentMethod)) {
    return badRequest(`paymentMethod must be one of: ${VALID_METHODS.join(", ")}`);
  }
  if (Number(amount) <= 0) return badRequest("amount must be positive");

  const row = await createEmployeeLedgerEntry(ctx.workspaceId, {
    employeeId,
    date,
    kind,
    amount: String(amount),
    operatingCompanyId: operatingCompanyId ?? null,
    payingOperatingCompanyId: payingOperatingCompanyId ?? null,
    dealRecordId: dealRecordId ?? null,
    paymentMethod: (paymentMethod as PaymentMethod | undefined) ?? null,
    description: description ?? null,
    notes: notes ?? null,
    isTaxDeductible: typeof isTaxDeductible === "boolean" ? isTaxDeductible : undefined,
    dueDate: dueDate ?? null,
    receiptFile: receiptFile ?? null,
  });
  return success(row, 201);
}
