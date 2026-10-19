/**
 * Idempotent backfill of deal `source_channel`.
 *
 * Sets the source only where the signal is unambiguous (one of WhatsApp,
 * Kleinanzeigen, ImmoScout24 / umzugsfirmen-check, Website-Formular,
 * Google-Profil). Never overwrites a value that is already set. Does not
 * write `first_reply_at`.
 *
 * Dry-run is the default and writes nothing.
 *
 *   cd apps/web
 *   pnpm exec tsx scripts/backfill-deal-source.ts
 *   pnpm exec tsx scripts/backfill-deal-source.ts --apply
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "../..");
for (const filePath of [
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
  path.join(webDir, ".env.local"),
  path.join(webDir, ".env"),
]) {
  loadEnv({ path: filePath, override: false, quiet: true });
}

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { channelAccounts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import {
  SOURCE_CHANNEL_SLUG,
  classifyInboundDealSource,
  extractKleinanzeigenDetail,
  sourceFromMovingLeadPayload,
  type SourceChannelTitle,
} from "@/lib/deal-source";
import { stampDealSourceIfEmpty } from "@/services/deal-attribution";

const apply = process.argv.includes("--apply");

async function main() {
  const workspaces = await db
    .select({ id: objects.workspaceId, objectId: objects.id })
    .from(objects)
    .where(eq(objects.slug, "deals"));

  const totals = {
    mode: apply ? "apply" : "dry-run",
    scanned: 0,
    alreadySet: 0,
    skippedAmbiguous: 0,
    skippedNoSignal: 0,
    updated: 0,
    byTitle: {} as Record<string, number>,
  };

  for (const workspace of workspaces) {
    const [sourceAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, workspace.objectId), eq(attributes.slug, SOURCE_CHANNEL_SLUG)))
      .limit(1);
    const [payloadAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, workspace.objectId), eq(attributes.slug, "moving_lead_payload")))
      .limit(1);
    if (!sourceAttr) {
      console.log(`workspace ${workspace.id}: no source_channel attribute, skipped`);
      continue;
    }

    const deals = await db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.objectId, workspace.objectId), isNull(records.deletedAt)));
    const dealIds = deals.map((deal) => deal.id);
    totals.scanned += dealIds.length;
    if (dealIds.length === 0) continue;

    const sourceRows = await db
      .select({ recordId: recordValues.recordId, textValue: recordValues.textValue })
      .from(recordValues)
      .where(and(eq(recordValues.attributeId, sourceAttr.id), inArray(recordValues.recordId, dealIds)));
    const already = new Set(sourceRows.filter((row) => row.textValue).map((row) => row.recordId));

    const payloadByDeal = new Map<string, unknown>();
    if (payloadAttr) {
      const payloadRows = await db
        .select({ recordId: recordValues.recordId, jsonValue: recordValues.jsonValue })
        .from(recordValues)
        .where(and(eq(recordValues.attributeId, payloadAttr.id), inArray(recordValues.recordId, dealIds)));
      for (const row of payloadRows) payloadByDeal.set(row.recordId, row.jsonValue);
    }

    const conversations = await db
      .select({
        id: inboxConversations.id,
        dealRecordId: inboxConversations.dealRecordId,
        subject: inboxConversations.subject,
        channelType: channelAccounts.channelType,
      })
      .from(inboxConversations)
      .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
      .where(and(eq(inboxConversations.workspaceId, workspace.id), inArray(inboxConversations.dealRecordId, dealIds)));

    const conversationIds = conversations.map((conversation) => conversation.id);
    const messages = conversationIds.length
      ? await db
          .select({
            conversationId: inboxMessages.conversationId,
            fromAddress: inboxMessages.fromAddress,
            subject: inboxMessages.subject,
            body: inboxMessages.body,
            sentAt: inboxMessages.sentAt,
          })
          .from(inboxMessages)
          .where(and(eq(inboxMessages.direction, "inbound"), inArray(inboxMessages.conversationId, conversationIds)))
          .orderBy(asc(inboxMessages.sentAt))
      : [];
    const firstMessage = new Map<string, (typeof messages)[number]>();
    for (const message of messages) {
      if (!firstMessage.has(message.conversationId)) firstMessage.set(message.conversationId, message);
    }

    const convsByDeal = new Map<string, typeof conversations>();
    for (const conversation of conversations) {
      if (!conversation.dealRecordId) continue;
      const list = convsByDeal.get(conversation.dealRecordId) ?? [];
      list.push(conversation);
      convsByDeal.set(conversation.dealRecordId, list);
    }

    for (const dealId of dealIds) {
      if (already.has(dealId)) {
        totals.alreadySet++;
        continue;
      }
      const titles = new Set<SourceChannelTitle>();
      let detail: string | null = null;
      let receivedAt: Date | null = null;
      for (const conversation of convsByDeal.get(dealId) ?? []) {
        const message = firstMessage.get(conversation.id);
        const title = classifyInboundDealSource({
          channelType: conversation.channelType,
          fromEmail: message?.fromAddress,
          subject: message?.subject ?? conversation.subject,
          body: message?.body,
        });
        if (!title) continue;
        titles.add(title);
        if (title === "Kleinanzeigen" && !detail) {
          detail = extractKleinanzeigenDetail(message?.subject ?? conversation.subject, message?.body);
        }
        if (message?.sentAt && (!receivedAt || message.sentAt < receivedAt)) receivedAt = message.sentAt;
      }
      const fromPayload = sourceFromMovingLeadPayload(payloadByDeal.get(dealId));
      if (fromPayload) titles.add(fromPayload);

      if (titles.size === 0) {
        totals.skippedNoSignal++;
        continue;
      }
      if (titles.size > 1) {
        totals.skippedAmbiguous++;
        continue;
      }
      const [title] = [...titles];
      totals.byTitle[title] = (totals.byTitle[title] ?? 0) + 1;
      totals.updated++;
      if (apply) {
        await stampDealSourceIfEmpty({
          dealRecordId: dealId,
          sourceTitle: title,
          sourceDetail: title === "Kleinanzeigen" ? detail : null,
          receivedAt,
        });
      }
    }
  }

  const optionCheck = await db
    .select({ title: selectOptions.title })
    .from(selectOptions)
    .innerJoin(attributes, eq(attributes.id, selectOptions.attributeId))
    .where(eq(attributes.slug, SOURCE_CHANNEL_SLUG))
    .limit(1);
  console.log(JSON.stringify({ ...totals, sourceOptionsPresent: optionCheck.length > 0 }, null, 2));
  if (!apply) console.log("Dry-run only. Re-run with --apply to write. Nothing was changed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
