/**
 * Throwaway integration test for deal-reuse (KOT-IDENTITY), against the REAL DB.
 * Proves createDealForNewConversation reuses an existing OPEN deal for the same
 * person + operating company instead of minting a duplicate lead. Self-cleaning.
 *
 * Run: NODE_ENV=production DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/test-deal-reuse-prod.ts
 */
import { db } from "@/db";
import { workspaces, objects, attributes, statuses, records, recordValues, inboxContacts, inboxConversations, channelAccounts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createRecord } from "@/services/records";
import { createDealForNewConversation } from "@/services/inbox";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ FAIL: ${n}`)); };

async function main() {
  const recIds: string[] = [];
  const contactIds: string[] = [];
  const convIds: string[] = [];
  const caIds: string[] = [];
  try {
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    const objBySlug = new Map((await db.select({ id: objects.id, slug: objects.slug }).from(objects).where(eq(objects.workspaceId, ws!.id))).map((o) => [o.slug, o.id]));
    const peopleObj = objBySlug.get("people")!;
    const dealsObj = objBySlug.get("deals")!;
    const ocObj = objBySlug.get("operating_companies")!;
    const dealAttrs = new Map((await db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, dealsObj))).map((a) => [a.slug, a.id]));
    const stageAttr = dealAttrs.get("stage")!;
    const stageStatuses = await db.select({ id: statuses.id, title: statuses.title }).from(statuses).where(eq(statuses.attributeId, stageAttr));
    const CLOSED = /gewonnen|won|verloren|lost|abgeschlossen|closed|abgesagt|storniert|abgelehnt|kein\s*interesse/i;
    const openStatus = stageStatuses.find((s) => !CLOSED.test(s.title));
    if (!openStatus) throw new Error("no open stage status found");

    const nameAttr = (await db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, peopleObj))).find((a) => a.slug === "name")!.id;

    // person
    const [person] = await db.insert(records).values({ objectId: peopleObj }).returning({ id: records.id });
    recIds.push(person.id);
    await db.insert(recordValues).values({ recordId: person.id, attributeId: nameAttr, jsonValue: { full_name: "ZZ_TEST DealReuse Person" }, sortOrder: 0 });
    // operating company
    const oc = await createRecord(ocObj, { name: "ZZ_TEST OC" }, null);
    if (oc) recIds.push(oc.id);
    // channel account on that OC
    const [ca] = await db.insert(channelAccounts).values({ workspaceId: ws!.id, operatingCompanyRecordId: oc!.id, channelType: "whatsapp", name: "ZZ_TEST CA", address: "zztest-ca-" + openStatus.id.slice(0, 8) }).returning({ id: channelAccounts.id });
    caIds.push(ca.id);
    // existing OPEN deal for person + OC
    const existingDeal = await createRecord(dealsObj, { name: "ZZ_TEST Existing Deal", stage: openStatus.id, associated_people: [person.id], operating_company: oc!.id }, null);
    if (existingDeal) recIds.push(existingDeal.id);
    // contact linked to the person + a conversation on the channel account
    const [contact] = await db.insert(inboxContacts).values({ workspaceId: ws!.id, displayName: "ZZ_TEST Contact", crmRecordId: person.id, phone: "499990000099" }).returning({ id: inboxContacts.id });
    contactIds.push(contact.id);
    const [conv] = await db.insert(inboxConversations).values({ workspaceId: ws!.id, channelAccountId: ca.id, contactId: contact.id, externalThreadId: "zztest-thread", status: "open" }).returning({ id: inboxConversations.id });
    convIds.push(conv.id);

    console.log("\nCalling createDealForNewConversation (should REUSE the open deal)...");
    const returned = await createDealForNewConversation({ workspaceId: ws!.id, conversationId: conv.id, dealName: "ZZ_TEST Should Not Be Created", contactId: contact.id, channelAccountId: ca.id });

    check("returned the EXISTING open deal (no new deal minted)", returned === existingDeal!.id);
    const [convRow] = await db.select({ d: inboxConversations.dealRecordId }).from(inboxConversations).where(eq(inboxConversations.id, conv.id));
    check("conversation linked to the existing deal", convRow?.d === existingDeal!.id);
    const stray = await db.select({ id: recordValues.recordId }).from(recordValues).innerJoin(records, eq(records.id, recordValues.recordId)).where(and(eq(records.objectId, dealsObj), eq(recordValues.textValue, "ZZ_TEST Should Not Be Created")));
    check("no duplicate deal was created", stray.length === 0);
  } finally {
    console.log("\nCleanup...");
    if (convIds.length) await db.delete(inboxConversations).where(inArray(inboxConversations.id, convIds));
    if (contactIds.length) await db.delete(inboxContacts).where(inArray(inboxContacts.id, contactIds));
    if (caIds.length) await db.delete(channelAccounts).where(inArray(channelAccounts.id, caIds));
    if (recIds.length) await db.delete(records).where(inArray(records.id, recIds));
    console.log("Cleanup done.");
  }
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
