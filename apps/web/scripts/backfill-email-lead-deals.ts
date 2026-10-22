/**
 * List (and, only with flags, create) deals for email conversations that
 * arrived before direct-mail / Möbeltransport24 / Formspree deal creation.
 *
 * Default is a dry run: it prints candidates and writes nothing. It never
 * calls the model and never sends mail or WhatsApp.
 *
 *   pnpm exec tsx apps/web/scripts/backfill-email-lead-deals.ts
 *   pnpm exec tsx apps/web/scripts/backfill-email-lead-deals.ts --apply
 *   pnpm exec tsx apps/web/scripts/backfill-email-lead-deals.ts --apply --classify
 *
 * --apply creates portal deals (Möbeltransport24, Website-Formular) only.
 * --classify additionally runs the KI classifier for direct lead mail and
 * may create a deal or a suggestion. It requires --apply.
 *
 * Channel accounts whose id starts with 595a5e23 (Ceylan) are skipped.
 * A thread that contains several inquiry ids is listed and left unchanged.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "../..");
for (const p of [
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
  path.join(webDir, ".env.local"),
  path.join(webDir, ".env"),
]) loadEnv({ path: p, override: false, quiet: true });

import { db } from "@/db";
import { channelAccounts, inboxContacts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { and, asc, eq } from "drizzle-orm";
import { isCeylanChannelAccount } from "@/lib/deal-enrichment-policy";
import { isLeadKunde } from "@/lib/kontaktart";
import { isPortalEnvelope, planStructuredEmailLead, type StructuredEmailPlan } from "@/lib/structured-email-lead";
import { createStructuredEmailDeal, reviewDirectEmailConversation } from "@/services/email-lead-deals";
import { resolveOrCreatePerson } from "@/services/inbox-crm-link";

const apply = process.argv.includes("--apply");
const classify = process.argv.includes("--classify");

interface MessageRow {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  body: string;
  sentAt: Date | null;
  externalMessageId: string | null;
}

interface ConversationBucket {
  id: string;
  workspaceId: string;
  channelAccountId: string;
  lane: string;
  kontaktart: string;
  dealRecordId: string | null;
  contactId: string;
  messages: MessageRow[];
}

async function upsertContact(workspaceId: string, email: string, displayName: string) {
  const [existing] = await db
    .select()
    .from(inboxContacts)
    .where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.email, email)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(inboxContacts)
    .values({ workspaceId, email, displayName: displayName || email })
    .returning();
  return created;
}

function plansFor(messages: MessageRow[]): StructuredEmailPlan[] {
  const seen = new Set<string>();
  const plans: StructuredEmailPlan[] = [];
  for (const message of messages) {
    const plan = planStructuredEmailLead({
      from: message.fromAddress ?? "",
      subject: message.subject ?? "",
      body: message.body,
      messageId: message.externalMessageId || message.id,
    });
    if (!plan || seen.has(plan.threadKey)) continue;
    seen.add(plan.threadKey);
    plans.push(plan);
  }
  return plans;
}

function portalEnvelope(messages: MessageRow[]): boolean {
  return messages.some((message) =>
    isPortalEnvelope({
      from: message.fromAddress ?? "",
      subject: message.subject,
      body: message.body,
    })
  );
}

async function main() {
  if (classify && !apply) {
    console.error("--classify braucht --apply. Ohne --apply bleibt es beim Dry-Run.");
    process.exit(1);
  }

  console.log(apply ? (classify ? "APPLY + CLASSIFY" : "APPLY (nur Portale)") : "DRY-RUN");
  console.log("Es wird nichts gesendet.");

  const rows = await db
    .select({
      conversationId: inboxConversations.id,
      workspaceId: inboxConversations.workspaceId,
      channelAccountId: inboxConversations.channelAccountId,
      lane: inboxConversations.lane,
      kontaktart: inboxConversations.kontaktart,
      dealRecordId: inboxConversations.dealRecordId,
      contactId: inboxConversations.contactId,
      messageId: inboxMessages.id,
      subject: inboxMessages.subject,
      fromAddress: inboxMessages.fromAddress,
      body: inboxMessages.body,
      sentAt: inboxMessages.sentAt,
      externalMessageId: inboxMessages.externalMessageId,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
    .innerJoin(inboxMessages, eq(inboxMessages.conversationId, inboxConversations.id))
    .where(and(eq(channelAccounts.channelType, "email"), eq(inboxMessages.direction, "inbound")))
    .orderBy(asc(inboxMessages.sentAt));

  const buckets = new Map<string, ConversationBucket>();
  let excludedCeylan = 0;
  for (const row of rows) {
    if (isCeylanChannelAccount(row.channelAccountId)) {
      if (!buckets.has(`skip:${row.conversationId}`)) excludedCeylan += 1;
      buckets.set(`skip:${row.conversationId}`, null as unknown as ConversationBucket);
      continue;
    }
    const bucket = buckets.get(row.conversationId) ?? {
      id: row.conversationId,
      workspaceId: row.workspaceId,
      channelAccountId: row.channelAccountId,
      lane: row.lane,
      kontaktart: row.kontaktart,
      dealRecordId: row.dealRecordId,
      contactId: row.contactId,
      messages: [],
    };
    bucket.messages.push({
      id: row.messageId,
      subject: row.subject,
      fromAddress: row.fromAddress,
      body: row.body,
      sentAt: row.sentAt,
      externalMessageId: row.externalMessageId,
    });
    buckets.set(row.conversationId, bucket);
  }

  const counts = {
    auto: 0,
    mehrere: 0,
    ki_pruefung: 0,
    nie: 0,
    geschrieben: 0,
    fehler: 0,
  };

  for (const [key, conv] of buckets) {
    if (key.startsWith("skip:") || !conv) continue;
    if (conv.dealRecordId) continue;

    const plans = plansFor(conv.messages);
    if (plans.length > 1) {
      counts.mehrere += 1;
      console.log(
        JSON.stringify({
          conversationId: conv.id,
          aktion: "mehrere Anfragen in einem Thread",
          anfragen: plans.map((plan) => plan.threadKey),
        })
      );
      continue;
    }

    if (plans.length === 1) {
      counts.auto += 1;
      const plan = plans[0];
      const receivedAt = conv.messages.find((message) => message.sentAt)?.sentAt ?? new Date();
      console.log(
        JSON.stringify({
          conversationId: conv.id,
          aktion: "auto",
          quelle: plan.sourceChannel,
          anfrage: plan.sourceDetail,
          deal: plan.dealName,
        })
      );
      if (!apply) continue;
      try {
        const contact = await upsertContact(conv.workspaceId, plan.contactEmail, plan.contactName);
        await resolveOrCreatePerson({
          workspaceId: conv.workspaceId,
          contactId: contact.id,
          displayName: plan.contactName || plan.contactEmail,
          email: plan.customerEmail,
          phone: plan.customerPhone,
          extraPhones: plan.customerPhone ? [plan.customerPhone] : [],
          leadSource: plan.leadSource,
          source: "import",
          trust: plan.kind === "moebeltransport24" ? "verified" : "claimed",
        });
        if (contact.id !== conv.contactId) {
          await db
            .update(inboxConversations)
            .set({ contactId: contact.id, updatedAt: new Date() })
            .where(eq(inboxConversations.id, conv.id));
        }
        const dealId = await createStructuredEmailDeal({
          workspaceId: conv.workspaceId,
          conversationId: conv.id,
          contactId: contact.id,
          channelAccountId: conv.channelAccountId,
          plan,
          receivedAt,
        });
        if (dealId) counts.geschrieben += 1;
      } catch (err) {
        counts.fehler += 1;
        console.error(conv.id, err instanceof Error ? err.message : "anlegen fehlgeschlagen");
      }
      continue;
    }

    if (portalEnvelope(conv.messages)) continue;
    if (conv.lane !== "lead") continue;
    if (!isLeadKunde(conv.kontaktart)) {
      counts.nie += 1;
      console.log(JSON.stringify({ conversationId: conv.id, aktion: "nie", grund: "kontaktart" }));
      continue;
    }

    counts.ki_pruefung += 1;
    console.log(JSON.stringify({ conversationId: conv.id, aktion: "ki_pruefung" }));
    if (!classify) continue;
    try {
      const result = await reviewDirectEmailConversation(conv.id, { write: true });
      console.log(JSON.stringify({ conversationId: conv.id, ergebnis: result.action, grund: result.reason }));
      if (result.action === "auto" || result.action === "suggest") counts.geschrieben += 1;
    } catch (err) {
      counts.fehler += 1;
      console.error(conv.id, err instanceof Error ? err.message : "klassifizierung fehlgeschlagen");
    }
  }

  console.log(JSON.stringify({ ...counts, ceylanAusgeschlossen: excludedCeylan }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : "backfill fehlgeschlagen");
    process.exit(1);
  });
