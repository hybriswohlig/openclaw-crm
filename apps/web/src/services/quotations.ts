import { db } from "@/db";
import { quotations, quotationLineItems, dealEmployees, employees } from "@/db/schema";
import type { CalculationAssumptions } from "@/db/schema/quotations";
import { eq } from "drizzle-orm";

export async function getQuotation(dealRecordId: string) {
  const [q] = await db
    .select()
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);

  if (!q) return null;

  const lineItems = await db
    .select()
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, q.id))
    .orderBy(quotationLineItems.sortOrder);

  return { ...q, lineItems };
}

export async function upsertQuotation(
  dealRecordId: string,
  input: {
    fixedPrice?: string | null;
    isVariable: boolean;
    notes?: string | null;
    /** Anzahlung in cents — gates Stage 2 in the customer portal when set. */
    depositRequiredCents?: number | null;
    /** Per-deal payment method shown to the customer. */
    paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
    /** ISO date — offer valid until. */
    validUntil?: string | null;
    /** Customer-facing free-text description of what the offer covers. */
    summary?: string | null;
    /** Whether to render the standard move inclusions on the portal. */
    showStandardInclusions?: boolean;
    /** Selected offer package slug (per operating company). */
    selectedPackageSlug?: string | null;
    /** Kalkulationsgrundlagen (Anfahrt, Etagen, Zugang, Inventarbasis) —
     *  landen über loadKvaSnapshot in der eingefrorenen KVA-Bestätigung. */
    calculationAssumptions?: CalculationAssumptions | null;
    lineItems?: Array<{
      id?: string;
      type: "helper" | "transporter" | "other";
      description?: string;
      quantity: number;
      unitRate: string;
      sortOrder: number;
    }>;
  }
) {
  const existing = await getQuotation(dealRecordId);

  let quotationId: string;

  if (existing) {
    const [updated] = await db
      .update(quotations)
      .set({
        fixedPrice: input.fixedPrice ?? null,
        isVariable: input.isVariable,
        notes: input.notes ?? null,
        depositRequiredCents:
          input.depositRequiredCents !== undefined
            ? input.depositRequiredCents
            : existing.depositRequiredCents,
        paymentMethodPreference:
          input.paymentMethodPreference !== undefined
            ? input.paymentMethodPreference
            : existing.paymentMethodPreference,
        validUntil:
          input.validUntil !== undefined ? input.validUntil : existing.validUntil,
        summary:
          input.summary !== undefined ? input.summary : existing.summary,
        showStandardInclusions:
          input.showStandardInclusions !== undefined
            ? input.showStandardInclusions
            : existing.showStandardInclusions,
        selectedPackageSlug:
          input.selectedPackageSlug !== undefined
            ? input.selectedPackageSlug
            : existing.selectedPackageSlug,
        calculationAssumptions:
          input.calculationAssumptions !== undefined
            ? input.calculationAssumptions
            : existing.calculationAssumptions,
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, existing.id))
      .returning();
    quotationId = updated.id;
  } else {
    const [created] = await db
      .insert(quotations)
      .values({
        dealRecordId,
        fixedPrice: input.fixedPrice ?? null,
        isVariable: input.isVariable,
        notes: input.notes ?? null,
        depositRequiredCents: input.depositRequiredCents ?? null,
        paymentMethodPreference: input.paymentMethodPreference ?? null,
        validUntil: input.validUntil ?? null,
        summary: input.summary ?? null,
        showStandardInclusions: input.showStandardInclusions ?? true,
        selectedPackageSlug: input.selectedPackageSlug ?? null,
        calculationAssumptions: input.calculationAssumptions ?? null,
      })
      .returning();
    quotationId = created.id;
  }

  if (input.lineItems !== undefined) {
    await db
      .delete(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quotationId));

    if (input.lineItems.length > 0) {
      await db.insert(quotationLineItems).values(
        input.lineItems.map((li) => ({
          quotationId,
          type: li.type,
          description: li.description ?? null,
          quantity: li.quantity,
          unitRate: li.unitRate,
          sortOrder: li.sortOrder,
        }))
      );
    }
  }

  return getQuotation(dealRecordId);
}

export async function getProfitSummary(dealRecordId: string) {
  const quotation = await getQuotation(dealRecordId);
  if (!quotation) return null;

  let revenue = 0;
  if (quotation.isVariable && quotation.lineItems.length > 0) {
    revenue = quotation.lineItems.reduce(
      (sum, li) => sum + li.quantity * Number(li.unitRate),
      0
    );
  } else if (quotation.fixedPrice) {
    revenue = Number(quotation.fixedPrice);
  }

  const assignments = await db
    .select({
      role: dealEmployees.role,
      hourlyRate: employees.hourlyRate,
      employeeName: employees.name,
    })
    .from(dealEmployees)
    .innerJoin(employees, eq(employees.id, dealEmployees.employeeId))
    .where(eq(dealEmployees.dealRecordId, dealRecordId));

  const helperLineItems = quotation.lineItems.filter((li) => li.type === "helper");
  const totalHelperHours = helperLineItems.reduce((sum, li) => sum + li.quantity, 0);
  const avgHoursPerHelper = assignments.length > 0 ? totalHelperHours / assignments.length : 0;

  const employeeExpenses = assignments.map((a) => ({
    name: a.employeeName,
    hourlyRate: Number(a.hourlyRate),
    estimatedHours: avgHoursPerHelper,
    cost: Number(a.hourlyRate) * avgHoursPerHelper,
  }));

  const totalExpenses = employeeExpenses.reduce((sum, e) => sum + e.cost, 0);
  const profit = revenue - totalExpenses;

  return {
    revenue,
    expenses: { employees: employeeExpenses, total: totalExpenses },
    profit,
  };
}
