import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updatePayment, deletePayment } from "@/services/financial";

const INCOME_TREATMENTS = ["betriebseinnahme", "nicht_steuerbar"] as const;
type IncomeTreatment = (typeof INCOME_TREATMENTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; paymentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { paymentId } = await params;
  const body = await req.json();
  const { date, amount, payer, paymentMethod, reference, notes, taxTreatment } = body;

  if (date !== undefined && !isValidDate(date)) {
    return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  }
  if (amount !== undefined && !isValidAmount(amount)) {
    return badRequest("Betrag muss größer 0 sein");
  }
  if (taxTreatment != null && !INCOME_TREATMENTS.includes(taxTreatment)) {
    return badRequest("taxTreatment muss betriebseinnahme oder nicht_steuerbar sein");
  }

  const row = await updatePayment(paymentId, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(payer !== undefined && { payer }),
    ...(paymentMethod !== undefined && { paymentMethod }),
    ...(reference !== undefined && { reference }),
    ...(notes !== undefined && { notes }),
    ...(taxTreatment != null && { taxTreatment: taxTreatment as IncomeTreatment }),
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
