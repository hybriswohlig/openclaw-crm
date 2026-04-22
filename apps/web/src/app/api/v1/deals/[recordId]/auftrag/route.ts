import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { activityEvents } from "@/db/schema/activity";
import { createRecord, getRecord } from "@/services/records";
import { DEFAULT_AUFTRAG_CHECKLIST } from "@openclaw-crm/shared";

export const dynamic = "force-dynamic";

/**
 * Returns the Auftrag linked to this deal (creating one on demand if none
 * exists), plus the criticalMissing / openCustomerQuestions from the latest
 * `ai.insights_extracted` activity event so the UI can show the orange
 * "wir müssen nachfragen" card.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId: dealRecordId } = await params;

  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);

  if (!auftragObj) {
    return success({
      auftrag: null,
      missing: "auftraege-object",
      hint: "Run `pnpm db:sync-objects` to provision the new Auftrag object.",
    });
  }

  const dealRefAttrRows = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, auftragObj.id), eq(attributes.slug, "deal")))
    .limit(1);
  const dealRefAttrId = dealRefAttrRows[0]?.id ?? null;

  let auftragRecordId: string | null = null;
  if (dealRefAttrId) {
    const refRows = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, auftragObj.id),
          eq(recordValues.attributeId, dealRefAttrId),
          eq(recordValues.referencedRecordId, dealRecordId)
        )
      )
      .limit(1);
    auftragRecordId = refRows[0]?.recordId ?? null;
  }

  // Create on demand with checklist template + copied operating_company + name
  if (!auftragRecordId) {
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "deals")))
      .limit(1);

    let auftragName = "Auftrag";
    let operatingCompanyId: string | null = null;
    if (dealObj) {
      const deal = await getRecord(dealObj.id, dealRecordId);
      if (deal) {
        const dealName = (deal.values as Record<string, unknown>).name;
        if (typeof dealName === "string" && dealName.trim()) {
          auftragName = `Auftrag – ${dealName}`;
        }
        const oc = (deal.values as Record<string, unknown>).operating_company;
        if (oc && typeof oc === "object" && "id" in oc) {
          operatingCompanyId = (oc as { id: string }).id;
        }
      }
    }

    const createInput: Record<string, unknown> = {
      name: auftragName,
      deal: dealRecordId,
      checklist: DEFAULT_AUFTRAG_CHECKLIST,
    };
    if (operatingCompanyId) createInput.operating_company = operatingCompanyId;

    const created = await createRecord(auftragObj.id, createInput, ctx.userId);
    auftragRecordId = created?.id ?? null;
  }

  const auftrag = auftragRecordId ? await getRecord(auftragObj.id, auftragRecordId) : null;

  // Pull the latest KI-insights event for this deal so we can expose criticalMissing + openCustomerQuestions
  const [latestInsight] = await db
    .select({ payload: activityEvents.payload, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ctx.workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        eq(activityEvents.eventType, "ai.insights_extracted")
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);

  const insightPayload = (latestInsight?.payload ?? {}) as Record<string, unknown>;

  return success({
    auftrag,
    criticalMissing: Array.isArray(insightPayload.criticalMissing)
      ? insightPayload.criticalMissing
      : [],
    openCustomerQuestions: Array.isArray(insightPayload.openCustomerQuestions)
      ? insightPayload.openCustomerQuestions
      : [],
    insightAt: latestInsight?.createdAt ?? null,
  });
}
