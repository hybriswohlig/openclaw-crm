import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dealEmployees } from "@/db/schema";
import { createPayment } from "@/services/financial";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, badRequest, success } from "@/lib/api-utils";

const VALID_METHODS = ["cash", "bank_transfer", "paypal", "card", "other"];

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
  if (!amount || Number(amount) <= 0) return badRequest("Betrag erforderlich.");
  const paymentMethod = VALID_METHODS.includes(method) ? method : "cash";

  const row = await createPayment(ctx.workspaceId, dealId, {
    date: new Date().toISOString().slice(0, 10),
    amount: String(amount),
    payer: ctx.employeeName,
    paymentMethod,
    notes: notes ?? "Vor Ort kassiert (Mitarbeiter-Portal)",
  });
  return success(row, 201);
}
