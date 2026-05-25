/**
 * GET /api/v1/deals/[recordId]/offer-packages
 *
 * Returns the offer packages defined for this deal's operating company plus
 * the currently selected slug on the quotation. Used by the quotation
 * calculator to render the picker.
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { offerPackages } from "@/db/schema/customer-portal";
import { quotations } from "@/db/schema/quotations";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  // Resolve the deal's operating company.
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "deals")))
    .limit(1);

  let operatingCompanyRecordId: string | null = null;
  if (dealObj) {
    const [ocAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(
        and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "operating_company"))
      )
      .limit(1);
    if (ocAttr) {
      const [val] = await db
        .select({ referencedRecordId: recordValues.referencedRecordId })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.recordId, recordId),
            eq(recordValues.attributeId, ocAttr.id)
          )
        )
        .limit(1);
      operatingCompanyRecordId = val?.referencedRecordId ?? null;
    }
  }

  const packages = operatingCompanyRecordId
    ? await db
        .select()
        .from(offerPackages)
        .where(
          and(
            eq(offerPackages.workspaceId, ctx.workspaceId),
            eq(offerPackages.operatingCompanyRecordId, operatingCompanyRecordId),
            eq(offerPackages.active, true)
          )
        )
        .orderBy(offerPackages.sortOrder)
    : [];

  const [q] = await db
    .select({ selectedPackageSlug: quotations.selectedPackageSlug })
    .from(quotations)
    .where(eq(quotations.dealRecordId, recordId))
    .limit(1);

  // Look up the operating-company display name to caption the picker.
  let operatingCompanyName: string | null = null;
  if (operatingCompanyRecordId) {
    const [rec] = await db
      .select({ objectId: records.objectId })
      .from(records)
      .where(eq(records.id, operatingCompanyRecordId))
      .limit(1);
    if (rec) {
      const [nameAttr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, rec.objectId), eq(attributes.slug, "name")))
        .limit(1);
      if (nameAttr) {
        const [v] = await db
          .select({ textValue: recordValues.textValue })
          .from(recordValues)
          .where(
            and(
              eq(recordValues.recordId, operatingCompanyRecordId),
              eq(recordValues.attributeId, nameAttr.id)
            )
          )
          .limit(1);
        operatingCompanyName = v?.textValue ?? null;
      }
    }
  }

  return success({
    operatingCompanyRecordId,
    operatingCompanyName,
    selectedSlug: q?.selectedPackageSlug ?? null,
    packages: packages.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      shortDescription: p.shortDescription,
      targetSegment: p.targetSegment,
      priceFromCents: p.priceFromCents,
      priceFixedFlag: p.priceFixedFlag,
      includedItems: Array.isArray(p.includedItems) ? p.includedItems : [],
      isRecommended: p.isRecommended,
      sortOrder: p.sortOrder,
    })),
  });
}
