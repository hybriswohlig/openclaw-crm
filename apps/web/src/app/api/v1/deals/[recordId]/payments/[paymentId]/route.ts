import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { updatePayment, deletePayment } from "@/services/financial";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; paymentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { paymentId } = await params;
  const body = await req.json();
  const { date, amount, payer, paymentMethod, reference, notes } = body;

  const row = await updatePayment(paymentId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(payer !== undefined && { payer }),
    ...(paymentMethod !== undefined && { paymentMethod }),
    ...(reference !== undefined && { reference }),
    ...(notes !== undefined && { notes }),
  });
  if (!row) return notFound("Payment not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; paymentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { paymentId } = await params;
  const row = await deletePayment(paymentId, ctx.workspaceId);
  if (!row) return notFound("Payment not found");
  return success({ deleted: true });
}
