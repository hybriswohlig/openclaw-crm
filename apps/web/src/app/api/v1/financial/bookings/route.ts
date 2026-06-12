import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { createCompanyBooking } from "@/services/financial";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { eq, and, isNull } from "drizzle-orm";

const VALID_TYPES = ["income", "expense"] as const;
type BookingType = (typeof VALID_TYPES)[number];

const VALID_CATEGORIES = ["fuel", "truck_rental", "equipment", "subcontractor", "toll", "other"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

/** Max accepted receipt data-URL length (~3 MB). Client compresses to ~2 MB. */
const MAX_RECEIPT_LENGTH = 3 * 1024 * 1024;

/** Optional free-text fields with their German label and max length. */
const STRING_LIMITS: Array<[key: string, label: string, max: number]> = [
  ["description", "Beschreibung", 500],
  ["payer", "Zahler", 200],
  ["recipient", "Empfänger", 200],
  ["paymentMethod", "Zahlungsart", 50],
  ["notes", "Notizen", 2000],
  ["receiptName", "Belegname", 255],
];

/** Verify the id is a live operating_companies record of this workspace. */
async function isOperatingCompany(workspaceId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, id),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "operating_companies"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  return Boolean(row);
}

/** Verify the deal record is live and belongs to this workspace (same approach as inbox link-deal). */
async function dealExists(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, dealRecordId),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "deals"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * POST /api/v1/financial/bookings
 *
 * Create a company-level booking (Einnahme/Ausgabe) that does not require a
 * deal. `operatingCompanyId` is mandatory; `dealRecordId` is optional.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const {
    type,
    operatingCompanyId,
    date,
    amount,
    dealRecordId,
    category,
    description,
    payer,
    recipient,
    paymentMethod,
    notes,
    isTaxDeductible,
    receiptFile,
    receiptName,
  } = body;

  if (!type || !VALID_TYPES.includes(type)) {
    return badRequest("type muss income oder expense sein");
  }
  if (!operatingCompanyId || typeof operatingCompanyId !== "string") {
    return badRequest("Gesellschaft ist erforderlich");
  }
  if (!isValidDate(date)) {
    return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  }
  if (!isValidAmount(amount)) {
    return badRequest("Betrag muss größer 0 sein");
  }
  if (!(await isOperatingCompany(ctx.workspaceId, operatingCompanyId))) {
    return badRequest("Gesellschaft nicht gefunden");
  }
  if (dealRecordId != null && dealRecordId !== "") {
    if (typeof dealRecordId !== "string" || !(await dealExists(ctx.workspaceId, dealRecordId))) {
      return badRequest("Auftrag nicht gefunden");
    }
  }
  if (category != null) {
    if (type !== "expense") {
      return badRequest("Kategorie ist nur für Ausgaben erlaubt");
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return badRequest(`Kategorie muss eine der folgenden sein: ${VALID_CATEGORIES.join(", ")}`);
    }
  }
  for (const [key, label, max] of STRING_LIMITS) {
    const value = body[key];
    if (value == null) continue;
    if (typeof value !== "string") return badRequest(`${label} muss ein Text sein`);
    if (value.length > max) return badRequest(`${label} darf höchstens ${max} Zeichen lang sein`);
  }
  if (receiptFile != null) {
    if (typeof receiptFile !== "string" || !receiptFile.startsWith("data:")) {
      return badRequest("Beleg muss eine Data-URL sein");
    }
    if (receiptFile.length > MAX_RECEIPT_LENGTH) {
      return badRequest("Beleg ist zu groß (max. 3 MB)");
    }
  }

  const row = await createCompanyBooking(ctx.workspaceId, {
    type: type as BookingType,
    operatingCompanyId,
    date,
    amount: String(amount),
    dealRecordId: dealRecordId || null,
    category: type === "expense" ? ((category as Category) ?? "other") : undefined,
    description,
    payer,
    recipient,
    paymentMethod,
    notes,
    isTaxDeductible:
      type === "expense"
        ? typeof isTaxDeductible === "boolean"
          ? isTaxDeductible
          : true
        : undefined,
    receiptFile: receiptFile ?? null,
    receiptName: receiptName ?? null,
  });
  return success(row, 201);
}
