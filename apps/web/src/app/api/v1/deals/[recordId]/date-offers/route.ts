/**
 * Operator-side composer for the multi-date offer.
 *
 *   GET    /api/v1/deals/[recordId]/date-offers
 *   POST   /api/v1/deals/[recordId]/date-offers   one offer
 *   PUT    /api/v1/deals/[recordId]/date-offers   replace the full set
 *   DELETE /api/v1/deals/[recordId]/date-offers   clear the set
 *
 * Validation: date YYYY-MM-DD, each slot needs a label, at most 10 offers
 * and 6 slots per offer. Writes return 409 while an acceptance is active.
 * None of these routes email or message the customer.
 */
import { NextRequest, NextResponse } from "next/server";
import { annahmeSperrAntwort } from "@/services/kva-annahme";
import { eq } from "drizzle-orm";
import { getAuthContext, unauthorized, success, badRequest, notFound } from "@/lib/api-utils";
import { db } from "@/db";
import { quotationDateOffers, customerDateSelections } from "@/db/schema/customer-portal";
import { MAX_DATE_OFFERS, parseDateOffer } from "@/lib/date-offer-input";
import {
  createDateOffer,
  DateOfferWriteError,
  replaceDateOffers,
  type DateOfferInput,
} from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

function writeError(err: unknown): NextResponse | null {
  const gesperrt = annahmeSperrAntwort(err);
  if (gesperrt) return gesperrt;
  if (err instanceof DateOfferWriteError) {
    if (err.reason === "not_found") return notFound("Date offer not found");
    return badRequest(`At most ${MAX_DATE_OFFERS} offers per deal`);
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
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
  if (!ctx) return unauthorized(req);
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
  if (body.offers.length > MAX_DATE_OFFERS) {
    return badRequest(`At most ${MAX_DATE_OFFERS} offers per deal`);
  }

  const offers: DateOfferInput[] = [];
  for (const raw of body.offers) {
    const parsed = parseDateOffer(raw);
    if (!parsed.ok) return badRequest(parsed.error);
    offers.push(parsed.offer);
  }

  try {
    const result = await replaceDateOffers({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      createdBy: ctx.userId,
      offers,
    });
    return success({ count: result.count });
  } catch (err) {
    const mapped = writeError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const parsed = parseDateOffer(body);
  if (!parsed.ok) return badRequest(parsed.error);
  try {
    const created = await createDateOffer({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      createdBy: ctx.userId,
      offer: parsed.offer,
    });
    return success(created, 201);
  } catch (err) {
    const mapped = writeError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  try {
    await replaceDateOffers({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      createdBy: ctx.userId,
      offers: [],
    });
    return success({ cleared: true });
  } catch (err) {
    const mapped = writeError(err);
    if (mapped) return mapped;
    throw err;
  }
}
