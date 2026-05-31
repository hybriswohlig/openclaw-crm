/**
 * Partial-update endpoint for the Anzahlung block of a deal's quotation.
 *
 *   PATCH /api/v1/deals/[recordId]/quotation/anzahlung
 *   body: {
 *     depositRequiredCents: number | null,
 *     paymentMethodPreference: "bank_transfer" | "paypal" | "cash" | "card" | null
 *   }
 *
 * Exists because the main quotation PUT endpoint expects the full
 * isVariable + fixedPrice + lineItems set, which the AB-generation dialog
 * doesn't have at hand. We can't do a partial PUT without dropping work,
 * so this route writes just the two Anzahlung-relevant columns through a
 * lightweight UPDATE that also creates a thin quotation row on first save.
 */
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  getAuthContext,
  unauthorized,
  success,
  badRequest,
} from "@/lib/api-utils";
import { db } from "@/db";
import { quotations } from "@/db/schema/quotations";

export const dynamic = "force-dynamic";

const VALID_METHODS = new Set([
  "bank_transfer",
  "paypal",
  "cash",
  "card",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  let body: {
    depositRequiredCents?: number | null;
    paymentMethodPreference?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Invalid JSON body");
  }

  // Validate. Both fields are optional but at least one should be present.
  const deposit =
    body.depositRequiredCents === null
      ? null
      : body.depositRequiredCents === undefined
        ? undefined
        : Number(body.depositRequiredCents);
  if (deposit !== undefined && deposit !== null) {
    if (!Number.isFinite(deposit) || deposit < 0) {
      return badRequest("depositRequiredCents must be a non-negative number or null");
    }
  }

  const method =
    body.paymentMethodPreference === null
      ? null
      : body.paymentMethodPreference === undefined
        ? undefined
        : String(body.paymentMethodPreference);
  if (method !== undefined && method !== null && !VALID_METHODS.has(method)) {
    return badRequest(
      `paymentMethodPreference must be one of bank_transfer | paypal | cash | card`
    );
  }

  const [existing] = await db
    .select({ id: quotations.id })
    .from(quotations)
    .where(eq(quotations.dealRecordId, recordId))
    .limit(1);

  if (existing) {
    const patch: Partial<typeof quotations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (deposit !== undefined) {
      patch.depositRequiredCents = deposit === null ? null : Math.round(deposit);
    }
    if (method !== undefined) {
      patch.paymentMethodPreference = method;
    }
    await db
      .update(quotations)
      .set(patch)
      .where(eq(quotations.id, existing.id));
  } else {
    // No quotation row yet — insert a thin one carrying just the Anzahlung
    // fields. The rest of the quotation (fixedPrice / line items / scope)
    // remains the operator's job in the calculator.
    await db.insert(quotations).values({
      dealRecordId: recordId,
      isVariable: false,
      depositRequiredCents:
        deposit === undefined || deposit === null
          ? null
          : Math.round(deposit),
      paymentMethodPreference: method === undefined ? null : method,
      showStandardInclusions: true,
    });
  }

  return success({
    depositRequiredCents:
      deposit === undefined ? null : deposit === null ? null : Math.round(deposit),
    paymentMethodPreference: method === undefined ? null : method,
  });
}
