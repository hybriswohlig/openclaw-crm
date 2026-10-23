/**
 * One alternative move date.
 *
 * PATCH  /api/v1/deals/[recordId]/date-offers/[offerId]
 * DELETE /api/v1/deals/[recordId]/date-offers/[offerId]
 *
 * Writes stay locked (409) while an acceptance is active.
 * Does not email or message the customer.
 */
import { NextRequest, NextResponse } from "next/server";
import { annahmeSperrAntwort } from "@/services/kva-annahme";
import { badRequest, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { MAX_DATE_OFFERS, parseDateOfferPatch } from "@/lib/date-offer-input";
import { DateOfferWriteError, deleteDateOffer, updateDateOffer } from "@/services/customer-portal-data";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; offerId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, offerId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const parsed = parseDateOfferPatch(body);
  if (!parsed.ok) return badRequest(parsed.error);
  try {
    const offer = await updateDateOffer({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      offerId,
      patch: parsed.patch,
    });
    return success({ offer });
  } catch (err) {
    const mapped = writeError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; offerId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, offerId } = await params;
  try {
    const deleted = await deleteDateOffer({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      offerId,
    });
    return success(deleted);
  } catch (err) {
    const mapped = writeError(err);
    if (mapped) return mapped;
    throw err;
  }
}
