import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listEmployeeTransactions, createEmployeeTransaction } from "@/services/financial";

const VALID_TYPES = ["salary", "advance", "reimbursement"] as const;
const VALID_STATUSES = ["open", "paid"] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listEmployeeTransactions(recordId);
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
  const { employeeId, date, type, amount, status, description, notes } = body;

  if (!employeeId) return badRequest("employeeId is required");
  if (!date || !amount) return badRequest("date and amount are required");
  if (!type || !VALID_TYPES.includes(type)) {
    return badRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const row = await createEmployeeTransaction(ctx.workspaceId, recordId, {
    employeeId,
    date,
    type,
    amount: String(amount),
    status: status ?? "open",
    description,
    notes,
  });
  return success(row, 201);
}
