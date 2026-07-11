import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dealEmployees } from "@/db/schema";
import { createExpense } from "@/services/financial";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, badRequest, success } from "@/lib/api-utils";
import { berlinDateString } from "@/lib/berlin-date";

const VALID_CATEGORIES = ["fuel", "truck_rental", "equipment", "subcontractor", "toll", "other"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

/**
 * Employee logs an expense for a job, with the receipt photo (already uploaded
 * to Blob + registered as job_media). Creates a deal-bound expense linked to the
 * photo as proof. The amount counts as a normal cost in the CRM finances.
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

  const body = await req.json();
  const { amount, category, description, jobMediaId } = body;
  if (!amount || Number(amount) <= 0) return badRequest("Betrag erforderlich.");
  const cat: Category = VALID_CATEGORIES.includes(category) ? category : "other";

  const row = await createExpense(ctx.workspaceId, dealId, {
    date: berlinDateString(),
    amount: String(amount),
    category: cat,
    description: description ?? `Beleg (${ctx.employeeName})`,
    receiptJobMediaId: jobMediaId ?? null,
    isTaxDeductible: true,
  });
  return success(row, 201);
}
