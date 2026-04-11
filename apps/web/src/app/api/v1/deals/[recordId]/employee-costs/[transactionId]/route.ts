import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateEmployeeTransaction, deleteEmployeeTransaction } from "@/services/financial";

const VALID_TYPES = ["salary", "advance", "reimbursement"] as const;
const VALID_STATUSES = ["open", "paid"] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; transactionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { transactionId } = await params;
  const body = await req.json();
  const { date, type, amount, status, description, notes } = body;

  if (type && !VALID_TYPES.includes(type)) {
    return badRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const row = await updateEmployeeTransaction(transactionId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(type !== undefined && { type }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(status !== undefined && { status }),
    ...(description !== undefined && { description }),
    ...(notes !== undefined && { notes }),
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
