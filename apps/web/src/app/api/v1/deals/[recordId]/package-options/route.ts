/**
 * Operator-side composer for per-deal package options.
 *
 *   GET  → current options + customer's selection (for hydrating UI)
 *   PUT  → replace the deal's full set of options
 *   DELETE → clear all options for the deal
 *
 * Validation: at most 6 options, displayName required + non-empty, priceCents
 * must be a non-negative integer.
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
import { quotationPackageOptions } from "@/db/schema/customer-portal";
import { quotations } from "@/db/schema/quotations";
import {
  replaceDealPackageOptions,
  type DealPackageOptionInput,
} from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

const MAX_OPTIONS = 6;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  const rows = await db
    .select()
    .from(quotationPackageOptions)
    .where(eq(quotationPackageOptions.dealRecordId, recordId))
    .orderBy(quotationPackageOptions.sortOrder);

  const [q] = await db
    .select({ selectedOptionId: quotations.selectedPackageOptionId })
    .from(quotations)
    .where(eq(quotations.dealRecordId, recordId))
    .limit(1);

  return success({
    options: rows.map((r) => ({
      id: r.id,
      catalogueSlug: r.catalogueSlug,
      displayName: r.displayName,
      shortDescription: r.shortDescription,
      priceCents: r.priceCents,
      includedItems: r.includedItems,
      excludedItems: r.excludedItems,
      addableItems: r.addableItems,
      note: r.note,
      isRecommended: r.isRecommended,
      sortOrder: r.sortOrder,
    })),
    selectedOptionId: q?.selectedOptionId ?? null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  let body: { options?: unknown };
  try {
    body = (await req.json()) as { options?: unknown };
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!Array.isArray(body.options)) {
    return badRequest("options must be an array");
  }
  if (body.options.length > MAX_OPTIONS) {
    return badRequest(`At most ${MAX_OPTIONS} options per deal`);
  }

  const options: DealPackageOptionInput[] = [];
  for (const raw of body.options as Array<Record<string, unknown>>) {
    const displayName =
      typeof raw.displayName === "string" ? raw.displayName.trim() : "";
    if (!displayName) {
      return badRequest("displayName required on every option");
    }
    const priceCents = Number(raw.priceCents);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      return badRequest(`Invalid priceCents for ${displayName}`);
    }
    const includedItemsRaw = Array.isArray(raw.includedItems)
      ? raw.includedItems
      : [];
    options.push({
      catalogueSlug:
        typeof raw.catalogueSlug === "string" && raw.catalogueSlug
          ? raw.catalogueSlug
          : null,
      displayName,
      shortDescription:
        typeof raw.shortDescription === "string" ? raw.shortDescription : null,
      priceCents: Math.round(priceCents),
      includedItems: (includedItemsRaw as unknown[]).filter(
        (s): s is string => typeof s === "string"
      ),
      excludedItems: (Array.isArray(raw.excludedItems)
        ? (raw.excludedItems as unknown[])
        : []
      ).filter((s): s is string => typeof s === "string"),
      addableItems: (Array.isArray(raw.addableItems)
        ? (raw.addableItems as unknown[])
        : []
      ).filter((s): s is string => typeof s === "string"),
      note: typeof raw.note === "string" ? raw.note : null,
      isRecommended: !!raw.isRecommended,
    });
  }

  const result = await replaceDealPackageOptions({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    createdBy: ctx.userId,
    options,
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
  await replaceDealPackageOptions({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    createdBy: ctx.userId,
    options: [],
  });
  return success({ cleared: true });
}
