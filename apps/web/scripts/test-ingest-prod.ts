/**
 * Throwaway integration test for the Phase 3 ingest contract resolveOrCreatePerson,
 * against the REAL database. Proves the headline fix:
 *   (1) Kleinanzeigen (relay, phone rescued from Tel. line) then WhatsApp on the
 *       SAME number resolve to ONE person — no duplicate.
 *   (2) when two person records share a hard key, ingest auto-merges them (D1).
 * Self-cleaning: every ZZ_TEST row it creates is deleted at the end.
 *
 * Run: NODE_ENV=production DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/test-ingest-prod.ts
 */
import { db } from "@/db";
import { workspaces, objects, attributes, records, recordValues, inboxContacts, personIdentifiers, personMergeEdges, activityEvents } from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { resolveOrCreatePerson } from "@/services/inbox-crm-link";
import { canonicalizePhone } from "@/lib/identity/canonical";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}`); }
}

const RELAY = "zztest-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de";

async function main() {
  const personIds = new Set<string>();
  const contactIds: string[] = [];

  try {
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) throw new Error("no workspace");
    const [peopleObj] = await db.select({ id: objects.id }).from(objects).where(and(eq(objects.workspaceId, ws.id), eq(objects.slug, "people"))).limit(1);
    if (!peopleObj) throw new Error("no people object");
    const attrRows = await db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, peopleObj.id));
    const attr = (s: string) => attrRows.find((a) => a.slug === s)?.id ?? null;
    const phoneAttr = attr("phone_numbers")!;
    const nameAttr = attr("name")!;

    const mkContact = async (displayName: string, email: string | null, phone: string | null) => {
      const [c] = await db.insert(inboxContacts).values({ workspaceId: ws.id, displayName, email, phone }).returning({ id: inboxContacts.id });
      contactIds.push(c.id);
      return c.id;
    };

    // ── Test 1: KA then WhatsApp on the same number = ONE person ─────────────
    console.log("\nTest 1: Kleinanzeigen -> WhatsApp cross-channel (no duplicate)");
    check("sanity: test number canonicalizes", canonicalizePhone("+49 999 0000010") !== null);

    const kaContact = await mkContact("ZZ_TEST KA Buyer", RELAY, null);
    const r1 = await resolveOrCreatePerson({
      workspaceId: ws.id, contactId: kaContact, displayName: "ZZ_TEST KA Buyer",
      email: RELAY, extraPhones: ["+49 999 0000010"], leadSource: "Kleinanzeigen", source: "kleinanzeigen",
    });
    if (r1.personRecordId) personIds.add(r1.personRecordId);
    check("KA inbound created a person", !!r1.personRecordId && r1.isNew);

    const waContact = await mkContact("ZZ_TEST WA Buyer", null, "499990000010");
    const r2 = await resolveOrCreatePerson({
      workspaceId: ws.id, contactId: waContact, displayName: "ZZ_TEST WA Buyer",
      phone: "499990000010", leadSource: "WhatsApp / Website", source: "whatsapp",
    });
    if (r2.personRecordId) personIds.add(r2.personRecordId);
    check("WhatsApp resolved to the SAME person (no duplicate)", !!r2.personRecordId && r2.personRecordId === r1.personRecordId);
    check("WhatsApp did NOT create a new person", r2.isNew === false);

    const [waContactRow] = await db.select({ crm: inboxContacts.crmRecordId }).from(inboxContacts).where(eq(inboxContacts.id, waContact));
    check("WhatsApp contact linked to the KA person", waContactRow?.crm === r1.personRecordId);

    // ── Test 2: auto-merge when two person records share a hard key ──────────
    console.log("\nTest 2: ingest auto-merge of a pre-existing duplicate");
    const mkPerson = async (full: string) => {
      const [rec] = await db.insert(records).values({ objectId: peopleObj.id }).returning({ id: records.id });
      personIds.add(rec.id);
      await db.insert(recordValues).values({ recordId: rec.id, attributeId: nameAttr, jsonValue: { first_name: "", last_name: "", full_name: full }, sortOrder: 0 });
      return rec.id;
    };
    const personA = await mkPerson("ZZ_TEST Dup A");
    const personB = await mkPerson("ZZ_TEST Dup B");
    // B owns the phone identity; a contact is already (wrongly) linked to A.
    await db.insert(personIdentifiers).values({ workspaceId: ws.id, personRecordId: personB, kind: "phone", valueRaw: "+49 999 0000020", valueCanonical: "+499990000020", source: "import", trust: "claimed" });
    const dupContact = await mkContact("ZZ_TEST Dup Contact", null, "499990000020");
    await db.update(inboxContacts).set({ crmRecordId: personA }).where(eq(inboxContacts.id, dupContact));

    const r3 = await resolveOrCreatePerson({
      workspaceId: ws.id, contactId: dupContact, displayName: "ZZ_TEST Dup Contact",
      phone: "499990000020", leadSource: "WhatsApp / Website", source: "whatsapp",
    });
    check("ingest reported an auto-merge", r3.autoMerged === true);
    const survivor = r3.personRecordId!;
    const loser = survivor === personA ? personB : personA;
    const [loserRow] = await db.select({ del: records.deletedAt, merged: records.mergedIntoRecordId }).from(records).where(eq(records.id, loser));
    check("the duplicate person was soft-deleted", !!loserRow?.del && loserRow?.merged === survivor);
    const [dupContactRow] = await db.select({ crm: inboxContacts.crmRecordId }).from(inboxContacts).where(eq(inboxContacts.id, dupContact));
    check("contact ends up on the survivor", dupContactRow?.crm === survivor);
  } finally {
    console.log("\nCleanup: removing all ZZ_TEST data...");
    const ids = [...personIds];
    if (ids.length) {
      await db.delete(personMergeEdges).where(or(inArray(personMergeEdges.survivorRecordId, ids), inArray(personMergeEdges.absorbedRecordId, ids)));
      await db.delete(activityEvents).where(inArray(activityEvents.recordId, ids));
    }
    if (contactIds.length) await db.delete(inboxContacts).where(inArray(inboxContacts.id, contactIds));
    if (ids.length) await db.delete(records).where(inArray(records.id, ids)); // cascades record_values + person_identifiers
    console.log("Cleanup done.");
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error("test-ingest-prod fatal:", err); process.exit(1); });
