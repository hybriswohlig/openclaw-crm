import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects, selectOptions, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import {
  FIRST_REPLY_AT_SLUG,
  SOURCE_CHANNEL_SLUG,
  SOURCE_DETAIL_SLUG,
  SOURCE_RECEIVED_AT_SLUG,
  isClosedSpeedToLeadStage,
  operatingCompanyKey,
  speedToLeadSla,
  type SpeedToLeadSla,
} from "@/lib/deal-source";

export interface SpeedToLeadRow {
  id: string;
  name: string;
  sourceChannel: string | null;
  sourceDetail: string | null;
  receivedAt: string | null;
  createdAt: string;
  ageMs: number;
  sla: SpeedToLeadSla;
  conversationId: string | null;
  company: "kottke" | "ceylan" | null;
  companyName: string | null;
}

export interface SpeedToLeadResult {
  records: SpeedToLeadRow[];
  sources: { id: string; title: string }[];
}

export async function listSpeedToLead(
  workspaceId: string,
  filter: { source?: string | null; company?: string | null }
): Promise<SpeedToLeadResult> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return { records: [], sources: [] };

  const attrs = await db.select().from(attributes).where(eq(attributes.objectId, dealObj.id));
  const attrBySlug = new Map(attrs.map((attr) => [attr.slug, attr]));
  const stageAttr = attrBySlug.get("stage");
  const nameAttr = attrBySlug.get("name");
  const sourceAttr = attrBySlug.get(SOURCE_CHANNEL_SLUG);
  const detailAttr = attrBySlug.get(SOURCE_DETAIL_SLUG);
  const receivedAttr = attrBySlug.get(SOURCE_RECEIVED_AT_SLUG);
  const replyAttr = attrBySlug.get(FIRST_REPLY_AT_SLUG);
  const companyAttr = attrBySlug.get("operating_company");

  const sourceOptions = sourceAttr
    ? await db
        .select({ id: selectOptions.id, title: selectOptions.title, sortOrder: selectOptions.sortOrder })
        .from(selectOptions)
        .where(eq(selectOptions.attributeId, sourceAttr.id))
        .orderBy(selectOptions.sortOrder)
    : [];
  const sourceById = new Map(sourceOptions.map((option) => [option.id, option.title]));

  const stageRows = stageAttr
    ? await db.select().from(statuses).where(eq(statuses.attributeId, stageAttr.id))
    : [];
  const stageById = new Map(stageRows.map((stage) => [stage.id, stage]));

  const dealRows = await db
    .select({ id: records.id, createdAt: records.createdAt })
    .from(records)
    .where(and(eq(records.objectId, dealObj.id), isNull(records.deletedAt)));
  if (dealRows.length === 0) {
    return { records: [], sources: sourceOptions.map(({ id, title }) => ({ id, title })) };
  }
  const dealIds = dealRows.map((deal) => deal.id);

  const wanted = [stageAttr, nameAttr, sourceAttr, detailAttr, receivedAttr, replyAttr, companyAttr]
    .map((attr) => attr?.id)
    .filter((id): id is string => !!id);
  const valueRows = wanted.length
    ? await db
        .select()
        .from(recordValues)
        .where(and(inArray(recordValues.recordId, dealIds), inArray(recordValues.attributeId, wanted)))
    : [];
  const valuesByDeal = new Map<string, Map<string, (typeof valueRows)[number]>>();
  for (const row of valueRows) {
    const bucket = valuesByDeal.get(row.recordId) ?? new Map();
    if (!bucket.has(row.attributeId)) bucket.set(row.attributeId, row);
    valuesByDeal.set(row.recordId, bucket);
  }

  const outbound = await db
    .selectDistinct({ dealRecordId: inboxConversations.dealRecordId })
    .from(inboxMessages)
    .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
    .where(
      and(
        eq(inboxMessages.workspaceId, workspaceId),
        eq(inboxMessages.direction, "outbound"),
        isNotNull(inboxConversations.dealRecordId)
      )
    );
  const replied = new Set(outbound.map((row) => row.dealRecordId).filter((id): id is string => !!id));

  const conversations = await db
    .select({
      id: inboxConversations.id,
      dealRecordId: inboxConversations.dealRecordId,
    })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.workspaceId, workspaceId), isNotNull(inboxConversations.dealRecordId)))
    .orderBy(desc(inboxConversations.lastMessageAt));
  const conversationByDeal = new Map<string, string>();
  for (const conversation of conversations) {
    if (conversation.dealRecordId && !conversationByDeal.has(conversation.dealRecordId)) {
      conversationByDeal.set(conversation.dealRecordId, conversation.id);
    }
  }

  const companyIds = new Set<string>();
  if (companyAttr) {
    for (const dealId of dealIds) {
      const ref = valuesByDeal.get(dealId)?.get(companyAttr.id)?.referencedRecordId;
      if (ref) companyIds.add(ref);
    }
  }
  const companyNames = await loadCompanyNames(workspaceId, [...companyIds]);

  const sourceFilter = (filter.source ?? "").trim().toLowerCase();
  const companyFilter = (filter.company ?? "").trim().toLowerCase();
  const now = Date.now();
  const rows: SpeedToLeadRow[] = [];

  for (const deal of dealRows) {
    const values = valuesByDeal.get(deal.id);
    const stageId = stageAttr ? values?.get(stageAttr.id)?.textValue ?? null : null;
    const stage = stageId ? stageById.get(stageId) : undefined;
    if (stage && isClosedSpeedToLeadStage(stage)) continue;
    if (replyAttr && values?.get(replyAttr.id)?.timestampValue) continue;
    if (replied.has(deal.id)) continue;

    const sourceId = sourceAttr ? values?.get(sourceAttr.id)?.textValue ?? null : null;
    const sourceTitle = sourceId ? sourceById.get(sourceId) ?? null : null;
    if (sourceFilter) {
      const matchesId = sourceId?.toLowerCase() === sourceFilter;
      const matchesTitle = sourceTitle?.toLowerCase() === sourceFilter;
      const matchesNone = sourceFilter === "none" && !sourceTitle;
      if (!matchesId && !matchesTitle && !matchesNone) continue;
    }

    const companyId = companyAttr ? values?.get(companyAttr.id)?.referencedRecordId ?? null : null;
    const companyName = companyId ? companyNames.get(companyId) ?? null : null;
    const company = operatingCompanyKey(companyName);
    if (companyFilter === "kottke" || companyFilter === "ceylan") {
      if (company !== companyFilter) continue;
    }

    const received = receivedAttr ? values?.get(receivedAttr.id)?.timestampValue ?? null : null;
    const receivedAt = received ?? deal.createdAt;
    const ageMs = Math.max(0, now - receivedAt.getTime());
    rows.push({
      id: deal.id,
      name: (nameAttr ? values?.get(nameAttr.id)?.textValue : null) || "Ohne Name",
      sourceChannel: sourceTitle,
      sourceDetail: detailAttr ? values?.get(detailAttr.id)?.textValue ?? null : null,
      receivedAt: received ? received.toISOString() : null,
      createdAt: deal.createdAt.toISOString(),
      ageMs,
      sla: speedToLeadSla(ageMs),
      conversationId: conversationByDeal.get(deal.id) ?? null,
      company,
      companyName,
    });
  }

  rows.sort((a, b) => b.ageMs - a.ageMs);
  return {
    records: rows,
    sources: sourceOptions.map(({ id, title }) => ({ id, title })),
  };
}

async function loadCompanyNames(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const [companyObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!companyObj) return names;
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, companyObj.id), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return names;
  const rows = await db
    .select({ recordId: recordValues.recordId, textValue: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.attributeId, nameAttr.id), inArray(recordValues.recordId, ids)));
  for (const row of rows) {
    if (row.textValue) names.set(row.recordId, row.textValue);
  }
  return names;
}
