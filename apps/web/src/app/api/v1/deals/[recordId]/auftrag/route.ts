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

  // ── Lead context: the fields that live on the Lead but are relevant for the
  // worker on-site. We surface them read-only on the Auftragsübersicht so the
  // worker sees everything in one view without hopping to the Attributes tab.
  const leadContext = await loadLeadContext(ctx.workspaceId, dealRecordId);

  return success({
    auftrag,
    leadContext,
    criticalMissing: Array.isArray(insightPayload.criticalMissing)
      ? insightPayload.criticalMissing
      : [],
    openCustomerQuestions: Array.isArray(insightPayload.openCustomerQuestions)
      ? insightPayload.openCustomerQuestions
      : [],
    insightAt: latestInsight?.createdAt ?? null,
  });
}

async function loadLeadContext(workspaceId: string, dealRecordId: string) {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return null;

  const attrRows = await db
    .select()
    .from(attributes)
    .where(eq(attributes.objectId, dealObj.id));
  const bySlug = new Map(attrRows.map((a) => [a.slug, a]));

  const wanted = [
    "name",
    "move_date",
    "move_from_address",
    "move_to_address",
    "floors_from",
    "floors_to",
    "elevator_from",
    "elevator_to",
    "inventory_notes",
  ];
  const wantedIds = wanted.map((s) => bySlug.get(s)?.id).filter((x): x is string => !!x);
  if (wantedIds.length === 0) return null;

  const vrows = await db
    .select()
    .from(recordValues)
    .where(
      and(eq(recordValues.recordId, dealRecordId))
    );
  const byAttr = new Map(vrows.map((r) => [r.attributeId, r]));

  // Resolve select option title for elevator_* fields (they store option IDs).
  const elevatorFromAttr = bySlug.get("elevator_from");
  const elevatorToAttr = bySlug.get("elevator_to");
  const selectOptionIds = [
    byAttr.get(elevatorFromAttr?.id ?? "")?.textValue,
    byAttr.get(elevatorToAttr?.id ?? "")?.textValue,
  ].filter((x): x is string => !!x);

  const optionTitles = new Map<string, string>();
  if (selectOptionIds.length > 0) {
    const { selectOptions } = await import("@/db/schema/objects");
    const { inArray } = await import("drizzle-orm");
    const opts = await db
      .select({ id: selectOptions.id, title: selectOptions.title })
      .from(selectOptions)
      .where(inArray(selectOptions.id, selectOptionIds));
    for (const o of opts) optionTitles.set(o.id, o.title);
  }

  function get(slug: string): unknown {
    const a = bySlug.get(slug);
    if (!a) return null;
    const v = byAttr.get(a.id);
    if (!v) return null;
    if (a.type === "location" || a.type === "json") return v.jsonValue ?? null;
    if (a.type === "number") return v.numberValue != null ? Number(v.numberValue) : null;
    if (a.type === "date") return v.dateValue ?? null;
    if (a.type === "select") {
      const id = v.textValue;
      return id ? optionTitles.get(id) ?? id : null;
    }
    return v.textValue ?? null;
  }

  return {
    name: get("name"),
    move_date: get("move_date"),
    move_from_address: get("move_from_address"),
    move_to_address: get("move_to_address"),
    floors_from: get("floors_from"),
    floors_to: get("floors_to"),
    elevator_from: get("elevator_from"),
    elevator_to: get("elevator_to"),
    inventory_notes: get("inventory_notes"),
  };
}
