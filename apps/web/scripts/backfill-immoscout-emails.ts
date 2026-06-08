/**
 * One-shot backfill: turn IS24 "Umzugsanfrage" emails that were ingested BEFORE
 * the IS24 lead path existed into structured deals, exactly as the live ingest
 * now does. Idempotent — dedup over the shared IS24 request id
 * (moving_lead_payload.externalId) means re-running never duplicates a deal.
 *
 * Run from the repo root or apps/web with:
 *   pnpm exec tsx apps/web/scripts/backfill-immoscout-emails.ts
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

// @/db connects lazily on first query, so loading env above (before main runs)
// is enough even though these imports are hoisted.
import { db } from "@/db";
import { inboxMessages, inboxConversations, inboxContacts } from "@/db/schema/inbox";
import { eq, and, sql } from "drizzle-orm";
import { isImmoscoutLeadEmail, parseImmoscoutLeadEmail } from "@/services/inbox-immoscout";
import { resolveOrCreatePerson } from "@/services/inbox-crm-link";
import { createDealForNewConversation } from "@/services/inbox";
import { findExistingMovingLeadDeal, setDealMovingLead } from "@/services/immoscout-sync";
import { computeLeadName } from "@/services/lead-name";

/** Inline contact upsert (mirrors inbox-email.upsertContact, which is private). */
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

async function main() {
  const rows = await db
    .select({
      messageId: inboxMessages.id,
      workspaceId: inboxMessages.workspaceId,
      conversationId: inboxMessages.conversationId,
      subject: inboxMessages.subject,
      fromAddress: inboxMessages.fromAddress,
      body: inboxMessages.body,
      channelAccountId: inboxConversations.channelAccountId,
      dealRecordId: inboxConversations.dealRecordId,
    })
    .from(inboxMessages)
    .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
    .where(
      and(
        eq(inboxMessages.direction, "inbound"),
        sql`lower(${inboxMessages.fromAddress}) like '%immobilienscout24.de%'`,
        sql`${inboxMessages.subject} ilike 'IS24 Umzugsanfrage%'`
      )
    );

  console.log(`Found ${rows.length} IS24 Umzugsanfrage messages.`);
  const result = { scanned: rows.length, created: 0, linked: 0, skipped: 0, errors: [] as string[] };
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isImmoscoutLeadEmail(row.fromAddress ?? "", row.subject ?? "")) {
      result.skipped++;
      continue;
    }
    const immo = parseImmoscoutLeadEmail(row.body ?? "");
    if (!immo || !immo.externalId) {
      result.skipped++;
      console.warn(`  skip (unparseable): ${row.subject}`);
      continue;
    }
    const key = `${row.workspaceId}:${immo.externalId}`;
    if (seen.has(key)) {
      result.skipped++;
      continue;
    }
    seen.add(key);

    try {
      const existingDeal = await findExistingMovingLeadDeal(row.workspaceId, immo.externalId);
      if (existingDeal) {
        await db
          .update(inboxConversations)
          .set({ dealRecordId: existingDeal, lane: "lead", updatedAt: new Date() })
          .where(eq(inboxConversations.id, row.conversationId));
        result.linked++;
        console.log(`  linked existing deal for ${immo.externalId} (${immo.customer.fullName})`);
        continue;
      }

      const contactName = immo.customer.fullName || "Unbekannt";
      const contactEmailKey = immo.customer.email ?? `is24-${immo.externalId}@is24.lead`;
      const contact = await upsertContact(row.workspaceId, contactEmailKey, contactName);
      await resolveOrCreatePerson({
        workspaceId: row.workspaceId,
        contactId: contact.id,
        displayName: contactName,
        email: immo.customer.email,
        phone: immo.customer.phone,
        extraPhones: immo.customer.phone ? [immo.customer.phone] : [],
        leadSource: "ImmobilienScout",
        source: "import",
        trust: "verified",
      });

      // Re-point the legacy conversation (was attached to the shared noreply@
      // contact) to the real customer + move it into the lead lane.
      await db
        .update(inboxConversations)
        .set({ contactId: contact.id, lane: "lead", aiNeedsReply: false, updatedAt: new Date() })
        .where(eq(inboxConversations.id, row.conversationId));

      const dealName = computeLeadName({
        customerName: immo.dealNameParts.customerName,
        fromAddress: immo.dealNameParts.fromCity,
        toAddress: immo.dealNameParts.toCity,
        moveDate: immo.dealNameParts.moveDate,
      });
      const dealId = await createDealForNewConversation({
        workspaceId: row.workspaceId,
        conversationId: row.conversationId,
        dealName,
        contactId: contact.id,
        channelAccountId: row.channelAccountId,
      });
      if (!dealId) {
        result.errors.push(`${immo.externalId}: deal creation returned null`);
        continue;
      }
      await setDealMovingLead({
        workspaceId: row.workspaceId,
        dealRecordId: dealId,
        payload: immo.payload,
        inventoryNotes: immo.inventoryNotes,
        moveDate: immo.dealNameParts.moveDate,
      });
      result.created++;
      console.log(`  created deal "${dealName}" (${immo.externalId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${immo.externalId}: ${msg}`);
      console.error(`  ERROR ${immo.externalId}: ${msg}`);
    }
  }

  console.log("\nBackfill result:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
