/**
 * Operator-side composer for the multi-date offer.
 *
 *   PUT /api/v1/deals/[recordId]/date-offers
 *   body: { offers: Array<{ date, slots: [...], note, isRecommended }> }
 *
 * Replaces the deal's full set of candidate dates. Validation:
 *   - date must be YYYY-MM-DD
 *   - each slot must have a non-empty label
 *   - at most 10 offers, at most 6 slots per offer
 *
 * GET returns the current set so the composer can hydrate.
 */
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { quotationDateOffers, customerDateSelections } from "@/db/schema/customer-portal";
import { replaceDateOffers, type DateOfferInput } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

const MAX_OFFERS = 10;
const MAX_SLOTS = 6;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  const rows = await db
    .select()
    .from(quotationDateOffers)
    .where(eq(quotationDateOffers.dealRecordId, recordId))
    .orderBy(quotationDateOffers.sortOrder);

  const [selection] = await db
    .select()
    .from(customerDateSelections)
    .where(eq(customerDateSelections.dealRecordId, recordId))
    .limit(1);

  return success({
    offers: rows.map((r) => ({
      id: r.id,
      date: r.offerDate,
      slots: r.slots,
      note: r.note,
      isRecommended: r.isRecommended,
      sortOrder: r.sortOrder,
    })),
    selection: selection
      ? {
          dateOfferId: selection.dateOfferId,
          selectedDate: selection.selectedDate,
          slotLabel: selection.selectedSlotLabel,
          startTime: selection.selectedSlotStart,
          endTime: selection.selectedSlotEnd,
          selectedAt: selection.selectedAt.toISOString(),
        }
      : null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  let body: { offers?: unknown };
  try {
    body = (await req.json()) as { offers?: unknown };
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!Array.isArray(body.offers)) {
    return badRequest("offers must be an array");
  }
  if (body.offers.length > MAX_OFFERS) {
    return badRequest(`At most ${MAX_OFFERS} offers per deal`);
  }

  const offers: DateOfferInput[] = [];
  for (const raw of body.offers as Array<Record<string, unknown>>) {
    const date = typeof raw.date === "string" ? raw.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return badRequest(`Invalid date: ${date}`);
    }
    const slotsRaw = Array.isArray(raw.slots) ? raw.slots : [];
    if (slotsRaw.length === 0) {
      return badRequest(`Each offer must have at least one slot (${date})`);
    }
    if (slotsRaw.length > MAX_SLOTS) {
      return badRequest(`At most ${MAX_SLOTS} slots per offer (${date})`);
    }
    const slots = (slotsRaw as Array<Record<string, unknown>>).map((s) => ({
      label: typeof s.label === "string" ? s.label.trim() : "",
      startTime: typeof s.startTime === "string" ? s.startTime : null,
      endTime: typeof s.endTime === "string" ? s.endTime : null,
    }));
    if (slots.some((s) => !s.label)) {
      return badRequest("Each slot needs a non-empty label");
    }
    offers.push({
      date,
      slots,
      note: typeof raw.note === "string" ? raw.note : null,
      isRecommended: !!raw.isRecommended,
    });
  }

  const result = await replaceDateOffers({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    createdBy: ctx.userId,
    offers,
  });

  return success({ count: result.count });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  await replaceDateOffers({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    createdBy: ctx.userId,
    offers: [],
  });
  return success({ cleared: true });
}
