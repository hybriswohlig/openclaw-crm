import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, notFound, success } from "@/lib/api-utils";
import {
  updateCompanyBooking,
  deleteCompanyBooking,
  type ExpenseCategory,
} from "@/services/financial";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { eq, and, isNull } from "drizzle-orm";

const VALID_TYPES = ["income", "expense"] as const;
type BookingType = (typeof VALID_TYPES)[number];

const CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value);
type Category = ExpenseCategory;

const EXPENSE_TREATMENTS = ["voll", "teilweise", "nicht"] as const;
type ExpenseTreatment = (typeof EXPENSE_TREATMENTS)[number];
const INCOME_TREATMENTS = ["betriebseinnahme", "nicht_steuerbar"] as const;
type IncomeTreatment = (typeof INCOME_TREATMENTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isValidPercent = (v: unknown) =>
  (typeof v === "number" || typeof v === "string") &&
  Number.isInteger(Number(v)) &&
  Number(v) >= 1 &&
  Number(v) <= 99;

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

function parseType(req: NextRequest): BookingType | null {
  const type = req.nextUrl.searchParams.get("type");
  return type && VALID_TYPES.includes(type as BookingType) ? (type as BookingType) : null;
}

/**
 * PATCH /api/v1/financial/bookings/[id]?type=income|expense
 *
 * Update a company booking. Validates only the fields present in the body.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const type = parseType(req);
  if (!type) return badRequest("Query-Parameter type muss income oder expense sein");

  const { id } = await params;
  const body = await req.json();
  const {
    date,
    amount,
    operatingCompanyId,
    dealRecordId,
    category,
    description,
    payer,
    recipient,
    paymentMethod,
    notes,
    isTaxDeductible,
    taxTreatment,
    deductiblePercent,
    receiptFile,
    receiptName,
  } = body;

  if (date !== undefined && !isValidDate(date)) {
    return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  }
  if (amount !== undefined && !isValidAmount(amount)) {
    return badRequest("Betrag muss größer 0 sein");
  }
  if (operatingCompanyId !== undefined) {
    if (
      !operatingCompanyId ||
      typeof operatingCompanyId !== "string" ||
      !(await isOperatingCompany(ctx.workspaceId, operatingCompanyId))
    ) {
      return badRequest("Gesellschaft nicht gefunden");
    }
  }
  if (dealRecordId !== undefined && dealRecordId !== null && dealRecordId !== "") {
    if (typeof dealRecordId !== "string" || !(await dealExists(ctx.workspaceId, dealRecordId))) {
      return badRequest("Auftrag nicht gefunden");
    }
  }
  if (category !== undefined && category !== null) {
    if (type !== "expense") {
      return badRequest("Kategorie ist nur für Ausgaben erlaubt");
    }
    if (!CATEGORY_VALUES.includes(category)) {
      return badRequest(`Kategorie muss eine der folgenden sein: ${CATEGORY_VALUES.join(", ")}`);
    }
  }
  if (isTaxDeductible !== undefined && typeof isTaxDeductible !== "boolean") {
    return badRequest("isTaxDeductible muss ein Boolean sein");
  }

  // --- Steuerliche Behandlung ------------------------------------------
  let resolvedTreatment: ExpenseTreatment | IncomeTreatment | undefined;
  let resolvedPercent: number | undefined;
  if (taxTreatment !== undefined && taxTreatment !== null) {
    if (type === "expense") {
      if (!EXPENSE_TREATMENTS.includes(taxTreatment)) {
        return badRequest("taxTreatment muss voll, teilweise oder nicht sein");
      }
    } else if (!INCOME_TREATMENTS.includes(taxTreatment)) {
      return badRequest("taxTreatment muss betriebseinnahme oder nicht_steuerbar sein");
    }
    resolvedTreatment = taxTreatment;
  } else if (type === "expense" && typeof isTaxDeductible === "boolean") {
    // Legacy-Clients senden noch isTaxDeductible statt taxTreatment.
    resolvedTreatment = isTaxDeductible ? "voll" : "nicht";
  }
  if (deductiblePercent !== undefined && deductiblePercent !== null) {
    if (type !== "expense") {
      return badRequest("deductiblePercent ist nur für Ausgaben erlaubt");
    }
    if (!isValidPercent(deductiblePercent)) {
      return badRequest("deductiblePercent muss eine ganze Zahl zwischen 1 und 99 sein");
    }
    if (resolvedTreatment !== "teilweise") {
      return badRequest("deductiblePercent ist nur bei taxTreatment teilweise erlaubt");
    }
    resolvedPercent = Number(deductiblePercent);
  }
  if (resolvedTreatment === "teilweise" && resolvedPercent === undefined) {
    resolvedPercent = 70;
  }
  // Bußgelder sind nie abziehbar (serverseitige Regel).
  if (type === "expense" && category === "fines") {
    resolvedTreatment = "nicht";
    resolvedPercent = undefined;
  }
  for (const [key, label, max] of STRING_LIMITS) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return badRequest(`${label} muss ein Text sein`);
    if (value.length > max) return badRequest(`${label} darf höchstens ${max} Zeichen lang sein`);
  }
  if (receiptFile !== undefined && receiptFile !== null) {
    if (typeof receiptFile !== "string" || !receiptFile.startsWith("data:")) {
      return badRequest("Beleg muss eine Data-URL sein");
    }
    if (receiptFile.length > MAX_RECEIPT_LENGTH) {
      return badRequest("Beleg ist zu groß (max. 3 MB)");
    }
  }

  const row = await updateCompanyBooking(id, type, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(operatingCompanyId !== undefined && { operatingCompanyId }),
    ...(dealRecordId !== undefined && { dealRecordId: dealRecordId || null }),
    ...(category !== undefined && { category: category as Category }),
    ...(description !== undefined && { description }),
    ...(payer !== undefined && { payer }),
    ...(recipient !== undefined && { recipient }),
    ...(paymentMethod !== undefined && { paymentMethod }),
    ...(notes !== undefined && { notes }),
    ...(resolvedTreatment !== undefined && { taxTreatment: resolvedTreatment }),
    ...(resolvedPercent !== undefined && { deductiblePercent: resolvedPercent }),
    ...(receiptFile !== undefined && { receiptFile: receiptFile || null }),
    ...(receiptName !== undefined && { receiptName: receiptName || null }),
  });
  if (!row) return notFound("Buchung nicht gefunden");
  return success(row);
}

/**
 * DELETE /api/v1/financial/bookings/[id]?type=income|expense
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const type = parseType(req);
  if (!type) return badRequest("Query-Parameter type muss income oder expense sein");

  const { id } = await params;
  const row = await deleteCompanyBooking(id, type, ctx.workspaceId);
  if (!row) return notFound("Buchung nicht gefunden");
  return success({ deleted: true });
}
