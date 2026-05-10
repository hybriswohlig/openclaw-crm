import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { listRecords } from "@/services/records";
import { db } from "@/db";
import { attributes, selectOptions, statuses } from "@/db/schema";
import type { FilterGroup } from "@openclaw-crm/shared";

/** GET /api/v1/deals/speed-to-lead
 *
 *  KOT-649 Phase 2 of KOT-607. Returns deals where:
 *    lead_source = "Kleinanzeigen"
 *    AND stage = "Inquiry"
 *    AND first_response_at IS NULL
 *  sorted by lead_received_at ASC. Empty payload (records: []) when the
 *  workspace hasn't been seeded yet so the client renders the empty state.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const dealsObj = await getObjectBySlug(ctx.workspaceId, "deals");
  if (!dealsObj) return success({ records: [], total: 0 });

  const [leadSourceAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "lead_source")))
    .limit(1);

  const [stageAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "stage")))
    .limit(1);

  // first_response_at + lead_received_at are referenced by slug in the filter,
  // so they don't need explicit lookup here. If either is missing the workspace
  // hasn't been synced — return empty rather than blowing up.
  if (!leadSourceAttr || !stageAttr) {
    return success({ records: [], total: 0 });
  }

  const [klOpt] = await db
    .select({ id: selectOptions.id })
    .from(selectOptions)
    .where(and(eq(selectOptions.attributeId, leadSourceAttr.id), eq(selectOptions.title, "Kleinanzeigen")))
    .limit(1);

  const [inquiryStatus] = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.attributeId, stageAttr.id), eq(statuses.title, "Inquiry")))
    .limit(1);

  if (!klOpt || !inquiryStatus) {
    return success({ records: [], total: 0 });
  }

  const filter: FilterGroup = {
    operator: "and",
    conditions: [
      { attribute: "lead_source", operator: "equals", value: klOpt.id },
      { attribute: "stage", operator: "equals", value: inquiryStatus.id },
      { attribute: "first_response_at", operator: "is_empty" },
    ],
  };

  const result = await listRecords(dealsObj.id, {
    limit: 200,
    offset: 0,
    filter,
    sorts: [{ attribute: "lead_received_at", direction: "asc" }],
  });

  const records = result.records.map((r) => ({
    id: r.id,
    name: typeof r.values.name === "string" ? r.values.name : "",
    leadSubsource: typeof r.values.lead_subsource === "string" ? r.values.lead_subsource : null,
    leadReceivedAt:
      r.values.lead_received_at instanceof Date
        ? r.values.lead_received_at.toISOString()
        : (r.values.lead_received_at as string | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return success({ records, total: result.total });
}
