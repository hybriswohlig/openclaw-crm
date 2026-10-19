/**
 * Writes deal Quelle, Erste Antwort, and the forward-only Angebot move.
 * Never imports the inbox services (they call into here).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects, selectOptions, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { channelAccounts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { updateRecord } from "./records";
import {
  FIRST_REPLY_AT_SLUG,
  LOSS_REASON_NOTE_SLUG,
  LOSS_REASON_SLUG,
  SOURCE_CHANNEL_SLUG,
  SOURCE_DETAIL_SLUG,
  SOURCE_RECEIVED_AT_SLUG,
  classifyInboundDealSource,
  decideQuotedAdvance,
  extractKleinanzeigenDetail,
  isCustomerOfferMessage,
  isLostStage,
  lossReasonProblem,
  QUOTED_REASONS,
} from "@/lib/deal-source";

async function dealObjectId(dealRecordId: string): Promise<string | null> {
  const [deal] = await db
    .select({ objectId: records.objectId })
    .from(records)
    .where(eq(records.id, dealRecordId))
    .limit(1);
  return deal?.objectId ?? null;
}

async function attributeMap(objectId: string) {
  const rows = await db.select().from(attributes).where(eq(attributes.objectId, objectId));
  return new Map(rows.map((row) => [row.slug, row]));
}

/** Resolve Quelle / Verlustgrund titles (or leave existing option ids) before a write. */
export async function resolveDealSelectInputs(
  objectId: string,
  values: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const next = { ...values };
  for (const slug of [SOURCE_CHANNEL_SLUG, LOSS_REASON_SLUG]) {
    const raw = next[slug];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const [attr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, slug)))
      .limit(1);
    if (!attr) continue;
    const options = await db
      .select({ id: selectOptions.id, title: selectOptions.title })
      .from(selectOptions)
      .where(eq(selectOptions.attributeId, attr.id));
    if (options.some((option) => option.id === raw)) continue;
    const match = options.find((option) => option.title.toLowerCase() === raw.trim().toLowerCase());
    if (match) next[slug] = match.id;
  }
  return next;
}

/** Set Quelle only when it is still empty. Missing attributes are a no-op. */
export async function stampDealSourceIfEmpty(input: {
  dealRecordId: string;
  sourceTitle: string | null | undefined;
  sourceDetail?: string | null;
  receivedAt?: Date | null;
}): Promise<void> {
  if (!input.sourceTitle) return;
  try {
    const objectId = await dealObjectId(input.dealRecordId);
    if (!objectId) return;
    const bySlug = await attributeMap(objectId);
    const sourceAttr = bySlug.get(SOURCE_CHANNEL_SLUG);
    if (!sourceAttr) return;

    const attrIds = [...bySlug.values()].map((attr) => attr.id);
    const existing = attrIds.length
      ? await db
          .select()
          .from(recordValues)
          .where(and(eq(recordValues.recordId, input.dealRecordId), inArray(recordValues.attributeId, attrIds)))
      : [];
    const sourceRow = existing.find((row) => row.attributeId === sourceAttr.id && row.textValue);
    if (sourceRow) return;

    const [option] = await db
      .select({ id: selectOptions.id })
      .from(selectOptions)
      .where(
        and(
          eq(selectOptions.attributeId, sourceAttr.id),
          sql`lower(${selectOptions.title}) = ${input.sourceTitle.trim().toLowerCase()}`
        )
      )
      .limit(1);
    if (!option) return;

    const updates: Record<string, unknown> = { [SOURCE_CHANNEL_SLUG]: option.id };
    const detailAttr = bySlug.get(SOURCE_DETAIL_SLUG);
    if (
      input.sourceDetail &&
      detailAttr &&
      !existing.some((row) => row.attributeId === detailAttr.id && row.textValue)
    ) {
      updates[SOURCE_DETAIL_SLUG] = input.sourceDetail;
    }
    const receivedAttr = bySlug.get(SOURCE_RECEIVED_AT_SLUG);
    if (
      input.receivedAt &&
      receivedAttr &&
      !existing.some((row) => row.attributeId === receivedAttr.id && row.timestampValue)
    ) {
      updates[SOURCE_RECEIVED_AT_SLUG] = input.receivedAt;
    }
    await updateRecord(objectId, input.dealRecordId, updates, null);
  } catch (err) {
    console.error("[deal-attribution] stamp source failed:", err);
  }
}

/** First real outbound to the customer. Never overwrites. */
export async function stampFirstReplyAtIfNull(
  dealRecordId: string | null | undefined,
  sentAt: Date
): Promise<void> {
  if (!dealRecordId) return;
  try {
    const objectId = await dealObjectId(dealRecordId);
    if (!objectId) return;
    const bySlug = await attributeMap(objectId);
    const attr = bySlug.get(FIRST_REPLY_AT_SLUG);
    if (!attr) return;
    const [existing] = await db
      .select({ timestampValue: recordValues.timestampValue })
      .from(recordValues)
      .where(and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, attr.id)))
      .limit(1);
    if (existing?.timestampValue) return;
    await updateRecord(objectId, dealRecordId, { [FIRST_REPLY_AT_SLUG]: sentAt }, null);
  } catch (err) {
    console.error("[deal-attribution] stamp first reply failed:", err);
  }
}

/** Stamp first reply, and move an earlier deal to Angebot when the body is an offer. */
export async function noteOutboundToCustomer(input: {
  workspaceId: string;
  dealRecordId: string | null | undefined;
  sentAt: Date;
  body?: string | null;
}): Promise<void> {
  if (!input.dealRecordId) return;
  await stampFirstReplyAtIfNull(input.dealRecordId, input.sentAt);
  if (!isCustomerOfferMessage(input.body)) return;
  await advanceDealToQuotedIfEarlier({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    reason: QUOTED_REASONS.offerMessage,
  });
}

export async function advanceDealToQuotedIfEarlier(input: {
  workspaceId: string;
  dealRecordId: string;
  reason: string;
}): Promise<void> {
  try {
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .innerJoin(records, eq(records.objectId, objects.id))
      .where(and(eq(records.id, input.dealRecordId), eq(objects.workspaceId, input.workspaceId), eq(objects.slug, "deals")))
      .limit(1);
    if (!dealObj) return;
    const [stageAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
      .limit(1);
    if (!stageAttr) return;
    const stageRows = await db.select().from(statuses).where(eq(statuses.attributeId, stageAttr.id));
    const [current] = await db
      .select({ textValue: recordValues.textValue })
      .from(recordValues)
      .where(and(eq(recordValues.recordId, input.dealRecordId), eq(recordValues.attributeId, stageAttr.id)))
      .limit(1);
    const nextId = decideQuotedAdvance({
      stages: stageRows.map((stage) => ({
        id: stage.id,
        title: stage.title,
        sortOrder: stage.sortOrder,
        stageCategory: stage.stageCategory,
      })),
      currentStageId: current?.textValue ?? null,
    });
    if (!nextId || nextId === current?.textValue) return;
    await updateRecord(dealObj.id, input.dealRecordId, { stage: nextId }, null, {
      activity: { reason: input.reason },
    });
  } catch (err) {
    console.error("[deal-attribution] quoted advance failed:", err);
  }
}

/** After a manual link, stamp Quelle from that conversation when it is unambiguous. */
export async function classifyAndStampFromConversation(
  conversationId: string,
  dealRecordId: string
): Promise<void> {
  try {
    const [conv] = await db
      .select()
      .from(inboxConversations)
      .where(eq(inboxConversations.id, conversationId))
      .limit(1);
    if (!conv) return;
    const [account] = await db
      .select({ channelType: channelAccounts.channelType })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, conv.channelAccountId))
      .limit(1);
    const [message] = await db
      .select({
        fromAddress: inboxMessages.fromAddress,
        subject: inboxMessages.subject,
        body: inboxMessages.body,
        sentAt: inboxMessages.sentAt,
      })
      .from(inboxMessages)
      .where(and(eq(inboxMessages.conversationId, conversationId), eq(inboxMessages.direction, "inbound")))
      .orderBy(asc(inboxMessages.sentAt))
      .limit(1);
    const title = classifyInboundDealSource({
      channelType: account?.channelType,
      fromEmail: message?.fromAddress,
      subject: message?.subject ?? conv.subject,
      body: message?.body,
    });
    if (!title) return;
    const detail =
      title === "Kleinanzeigen"
        ? extractKleinanzeigenDetail(message?.subject ?? conv.subject, message?.body)
        : null;
    await stampDealSourceIfEmpty({
      dealRecordId,
      sourceTitle: title,
      sourceDetail: detail,
      receivedAt: message?.sentAt ?? null,
    });
  } catch (err) {
    console.error("[deal-attribution] classify conversation failed:", err);
  }
}

export async function lossReasonUpdateProblem(input: {
  objectId: string;
  recordId: string;
  values: Record<string, unknown>;
  enforce: boolean;
}): Promise<string | null> {
  const stageRaw = input.values.stage;
  const moving = typeof stageRaw === "string" && stageRaw.length > 0;
  const [stageAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, input.objectId), eq(attributes.slug, "stage")))
    .limit(1);
  let movingToLost = false;
  if (moving && stageAttr) {
    const [target] = await db
      .select({ title: statuses.title, stageCategory: statuses.stageCategory })
      .from(statuses)
      .where(and(eq(statuses.id, stageRaw as string), eq(statuses.attributeId, stageAttr.id)))
      .limit(1);
    movingToLost = !!target && isLostStage(target);
  }

  const reasonAttr = await selectAttr(input.objectId, LOSS_REASON_SLUG);
  const noteAttr = await selectAttr(input.objectId, LOSS_REASON_NOTE_SLUG);
  const stored = await storedText(input.recordId, [reasonAttr?.id, noteAttr?.id]);

  let reasonTitle: string | null = null;
  if (typeof input.values[LOSS_REASON_SLUG] === "string" && reasonAttr) {
    reasonTitle = await optionTitle(reasonAttr.id, input.values[LOSS_REASON_SLUG] as string);
  } else if (reasonAttr) {
    const storedId = stored.get(reasonAttr.id) ?? null;
    reasonTitle = storedId ? await optionTitle(reasonAttr.id, storedId) : null;
  }

  const note = Object.prototype.hasOwnProperty.call(input.values, LOSS_REASON_NOTE_SLUG)
    ? stringOrNull(input.values[LOSS_REASON_NOTE_SLUG])
    : noteAttr
      ? stored.get(noteAttr.id) ?? null
      : null;

  return lossReasonProblem({ enforce: input.enforce, movingToLost, reasonTitle, note });
}

async function selectAttr(objectId: string, slug: string) {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, slug)))
    .limit(1);
  return attr ?? null;
}

async function storedText(recordId: string, attributeIds: Array<string | undefined>) {
  const ids = attributeIds.filter((id): id is string => !!id);
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ attributeId: recordValues.attributeId, textValue: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, recordId), inArray(recordValues.attributeId, ids)));
  for (const row of rows) {
    if (row.textValue) map.set(row.attributeId, row.textValue);
  }
  return map;
}

async function optionTitle(attributeId: string, value: string): Promise<string | null> {
  const options = await db
    .select({ id: selectOptions.id, title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.attributeId, attributeId));
  const byId = options.find((option) => option.id === value);
  if (byId) return byId.title;
  const byTitle = options.find((option) => option.title.toLowerCase() === value.trim().toLowerCase());
  return byTitle?.title ?? null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}
