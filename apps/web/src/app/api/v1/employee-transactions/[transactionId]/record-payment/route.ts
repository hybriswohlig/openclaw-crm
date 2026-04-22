import { NextRequest } from "next/server";
import { getAuthContext, badRequest, notFound, success, unauthorized } from "@/lib/api-utils";
import { recordEmployeeTransactionPayment } from "@/services/financial";

export const dynamic = "force-dynamic";

/**
 * Add (or subtract) a payment against a transaction. Body: { delta: number }.
 * Positive delta records a payment received; negative reverses one.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { transactionId } = await params;
  let delta: number | null = null;
  try {
    const body = await req.json();
    if (typeof body?.delta === "number" && Number.isFinite(body.delta)) {
      delta = body.delta;
    }
  } catch {
    // ignore — handled below
  }
  if (delta === null) return badRequest("delta (number) is required");

  const row = await recordEmployeeTransactionPayment(transactionId, ctx.workspaceId, delta);
  if (!row) return notFound("Transaction not found");
  return success(row);
}
