import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listPayments, createPayment } from "@/services/financial";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listPayments(recordId);
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
  const { date, amount, payer, paymentMethod, reference, notes } = body;

  if (!date || !amount) return badRequest("date and amount are required");

  const row = await createPayment(ctx.workspaceId, recordId, {
    date,
    amount: String(amount),
    payer,
    paymentMethod,
    reference,
    notes,
  });
  return success(row, 201);
}
