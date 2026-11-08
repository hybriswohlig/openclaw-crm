import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dealEmployees } from "@/db/schema";
import { createPayment } from "@/services/financial";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, badRequest, success } from "@/lib/api-utils";
import { berlinDateString } from "@/lib/berlin-date";
import { offenerRest } from "@/services/offener-rest";
import { nachZahlung } from "@/services/nach-zahlung";
import { erinnerungenStoppen } from "@/services/rechnungen";

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
  if (!ctx) return unauthorized(req);
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

  // Obergrenze aus dem einen „offen“ (Plan 9, Entscheidung 10): Rest plus 50 €;
  // ohne bekannten Rest (Stunden-KV ohne Rechnung, kein Angebot) nur die harte Grenze.
  const offen = await offenerRest(ctx.workspaceId, dealId);
  if (offen.restCent != null) {
    const restEur = offen.restCent / 100;
    if (amountNum > restEur + OVERPAY_TOLERANCE_EUR + 0.005) {
      return badRequest(`Betrag übersteigt den offenen Restbetrag (${restEur.toFixed(2)} €).`);
    }
  }

  const row = await createPayment(ctx.workspaceId, dealId, {
    date: berlinDateString(),
    amount: String(amountNum),
    payer: ctx.employeeName,
    paymentMethod,
    notes: notes ?? "Vor Ort kassiert (Mitarbeiter-Portal)",
    quelle: "mitarbeiter",
    employeeId: ctx.employeeId,
  });
  // Gemeinsamer Abschluss (G6): mit gestellter Rechnung und Rest 0 gilt der Auftrag als bezahlt.
  try {
    await nachZahlung(ctx.workspaceId, dealId, null);
  } catch (err) {
    console.error("[nach-zahlung] nach Kassieren fehlgeschlagen:", err);
  }
  await erinnerungenStoppen(ctx.workspaceId, dealId, "zahlung").catch(() => {});
  return success(row, 201);
}
