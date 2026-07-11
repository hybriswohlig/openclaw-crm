import { NextRequest } from "next/server";
import { and, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { dealEmployees, payments, kvaConfirmations, quotations } from "@/db/schema";
import { createPayment } from "@/services/financial";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, badRequest, success } from "@/lib/api-utils";
import { berlinDateString } from "@/lib/berlin-date";

const VALID_METHODS = ["cash", "bank_transfer", "paypal", "card", "other"];
/** Hard ceiling for a single on-site collection (EUR). Prevents fat-finger / fraud. */
const MAX_PORTAL_PAYMENT_EUR = 25_000;
/** Soft over-collection tolerance (EUR) when a quote exists. */
const OVERPAY_TOLERANCE_EUR = 50;

/**
 * The job lead records that the customer paid (Kassieren). Creates an income
 * payment on the deal so the outstanding amount drops. method: Bar/Überweisung/
 * PayPal/Karte.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const ctx = await getEmployeePortalContextFromHeaders(req.headers);
  if (!ctx) return unauthorized();
  const { dealId } = await params;

  const [assigned] = await db
    .select({ id: dealEmployees.id })
    .from(dealEmployees)
    .where(
      and(
        eq(dealEmployees.dealRecordId, dealId),
        eq(dealEmployees.employeeId, ctx.employeeId)
      )
    )
    .limit(1);
  if (!assigned) return badRequest("Nicht diesem Auftrag zugewiesen.");

  const { amount, method, notes } = await req.json();
  const amountNum = Number(amount);
  if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
    return badRequest("Betrag erforderlich.");
  }
  if (amountNum > MAX_PORTAL_PAYMENT_EUR) {
    return badRequest(
      `Betrag zu hoch (max. ${MAX_PORTAL_PAYMENT_EUR.toLocaleString("de-DE")} € pro Buchung).`
    );
  }
  const paymentMethod = VALID_METHODS.includes(method) ? method : "cash";

  // Cap against remaining outstanding when a quote / KVA total exists.
  const [accept] = await db
    .select({ confirmedTotalCents: kvaConfirmations.confirmedTotalCents })
    .from(kvaConfirmations)
    .where(eq(kvaConfirmations.dealRecordId, dealId))
    .limit(1);
  let quotedEur: number | null =
    accept?.confirmedTotalCents != null
      ? accept.confirmedTotalCents / 100
      : null;
  if (quotedEur == null) {
    const [q] = await db
      .select({ fixedPrice: quotations.fixedPrice })
      .from(quotations)
      .where(eq(quotations.dealRecordId, dealId))
      .limit(1);
    if (q?.fixedPrice != null) quotedEur = Number(q.fixedPrice);
  }
  if (quotedEur != null && quotedEur > 0) {
    const [paid] = await db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .where(eq(payments.dealRecordId, dealId));
    const paidSum = Number(paid?.total ?? 0);
    const remaining = quotedEur - paidSum + OVERPAY_TOLERANCE_EUR;
    if (amountNum > remaining + 0.005) {
      return badRequest(
        `Betrag übersteigt den offenen Restbetrag (${Math.max(0, quotedEur - paidSum).toFixed(2)} €).`
      );
    }
  }

  const row = await createPayment(ctx.workspaceId, dealId, {
    date: berlinDateString(),
    amount: String(amountNum),
    payer: ctx.employeeName,
    paymentMethod,
    notes: notes ?? "Vor Ort kassiert (Mitarbeiter-Portal)",
  });
  return success(row, 201);
}
