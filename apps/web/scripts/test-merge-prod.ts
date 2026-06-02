/**
 * Throwaway integration test for mergePersons / splitPersons against the REAL
 * database schema. Creates clearly-marked ZZ_TEST records, exercises a merge and
 * an un-merge, asserts correctness + lossless reversal, then deletes everything
 * it created. Never touches a real customer record.
 *
 * Run: DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/test-merge-prod.ts
 */
import { db } from "@/db";
import {
  workspaces,
  objects,
  attributes,
  records,
  recordValues,
  inboxContacts,
  personIdentifiers,
  personMergeEdges,
  activityEvents,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { mergePersons, splitPersons } from "@/services/person-merge";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${name}`);
  }
}

async function main() {
  const created = {
    recordIds: [] as string[],
    contactIds: [] as string[],
    identifierIds: [] as string[],
    edgeIds: [] as string[],
  };

  try {
    // ── Setup: resolve workspace + people/deals attributes ───────────────────
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) throw new Error("no workspace");
    const [peopleObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, ws.id), eq(objects.slug, "people")))
      .limit(1);
    if (!peopleObj) throw new Error("no people object");
    const attrRows = await db
      .select({ id: attributes.id, slug: attributes.slug, objectId: attributes.objectId })
      .from(attributes);
    const peopleAttr = (slug: string) =>
      attrRows.find((a) => a.objectId === peopleObj.id && a.slug === slug)?.id ?? null;
    const nameAttr = peopleAttr("name");
    const phoneAttr = peopleAttr("phone_numbers");
    const emailAttr = peopleAttr("email_addresses");
    const assocPeopleAttr = attrRows.find((a) => a.slug === "associated_people")?.id ?? null;
    if (!nameAttr || !phoneAttr || !emailAttr) throw new Error("missing people attrs");

    const mkPerson = async (full: string, phoneRaw: string, emailRaw: string) => {
      const [rec] = await db.insert(records).values({ objectId: peopleObj.id }).returning({ id: records.id });
      created.recordIds.push(rec.id);
      await db.insert(recordValues).values([
        { recordId: rec.id, attributeId: nameAttr, jsonValue: { first_name: "", last_name: "", full_name: full }, sortOrder: 0 },
        { recordId: rec.id, attributeId: phoneAttr, textValue: phoneRaw, sortOrder: 0 },
        { recordId: rec.id, attributeId: emailAttr, textValue: emailRaw, sortOrder: 0 },
      ]);
      return rec.id;
    };

    console.log("Setup: creating throwaway ZZ_TEST people...");
    const survivor = await mkPerson("ZZ_TEST Survivor", "+49 999 0000001", "zz_test_shared@example.test");
    const absorbed = await mkPerson("ZZ_TEST Absorbed", "+49 999 0000002", "zz_test_shared@example.test");

    // A referencing record (simulating a deal's associated_people -> absorbed).
    const [refHolder] = await db.insert(records).values({ objectId: peopleObj.id }).returning({ id: records.id });
    created.recordIds.push(refHolder.id);
    if (assocPeopleAttr) {
      await db.insert(recordValues).values({
        recordId: refHolder.id,
        attributeId: assocPeopleAttr,
        referencedRecordId: absorbed,
        sortOrder: 0,
      });
    }

    // inbox_contact linked to absorbed.
    const [contact] = await db
      .insert(inboxContacts)
      .values({ workspaceId: ws.id, crmRecordId: absorbed, displayName: "ZZ_TEST Absorbed", phone: "+49 999 0000002" })
      .returning({ id: inboxContacts.id });
    created.contactIds.push(contact.id);

    // person_identifier on absorbed (fake canonical, no real-data collision).
    const [ident] = await db
      .insert(personIdentifiers)
      .values({ workspaceId: ws.id, personRecordId: absorbed, kind: "phone", valueRaw: "+49 999 0000002", valueCanonical: "+499990000002", source: "import", trust: "claimed" })
      .returning({ id: personIdentifiers.id });
    created.identifierIds.push(ident.id);

    // activity_event on absorbed.
    await db.insert(activityEvents).values({ workspaceId: ws.id, recordId: absorbed, objectSlug: "people", eventType: "message.received", payload: {} });

    // ── MERGE ─────────────────────────────────────────────────────────────────
    console.log("\nRunning mergePersons(survivor <- absorbed)...");
    const { mergeEdgeId } = await mergePersons({
      workspaceId: ws.id,
      survivorId: survivor,
      absorbedId: absorbed,
      method: "manual",
      actorId: null,
      evidence: { test: true },
    });
    created.edgeIds.push(mergeEdgeId);

    const [absRow] = await db.select().from(records).where(eq(records.id, absorbed)).limit(1);
    check("absorbed is soft-deleted", !!absRow?.deletedAt);
    check("absorbed.merged_into = survivor", absRow?.mergedIntoRecordId === survivor);

    const refAfter = await db.select({ ref: recordValues.referencedRecordId }).from(recordValues).where(eq(recordValues.recordId, refHolder.id));
    check("deal reference rewritten absorbed -> survivor", refAfter.some((r) => r.ref === survivor) && !refAfter.some((r) => r.ref === absorbed));

    const [contactAfter] = await db.select({ crm: inboxContacts.crmRecordId }).from(inboxContacts).where(eq(inboxContacts.id, contact.id));
    check("inbox_contact re-pointed to survivor", contactAfter?.crm === survivor);

    const [identAfter] = await db.select({ p: personIdentifiers.personRecordId }).from(personIdentifiers).where(eq(personIdentifiers.id, ident.id));
    check("person_identifier re-pointed to survivor", identAfter?.p === survivor);

    const actAfter = await db.select({ id: activityEvents.id }).from(activityEvents).where(eq(activityEvents.recordId, absorbed));
    check("activity_events moved off absorbed", actAfter.length === 0);

    const survPhones = await db.select({ t: recordValues.textValue }).from(recordValues).where(and(eq(recordValues.recordId, survivor), eq(recordValues.attributeId, phoneAttr)));
    check("survivor gained absorbed's unique phone", survPhones.some((p) => p.t === "+49 999 0000002"));
    const survEmails = await db.select({ t: recordValues.textValue }).from(recordValues).where(and(eq(recordValues.recordId, survivor), eq(recordValues.attributeId, emailAttr)));
    check("shared email NOT duplicated on survivor", survEmails.filter((e) => e.t === "zz_test_shared@example.test").length === 1);

    const [edgeRow] = await db.select().from(personMergeEdges).where(eq(personMergeEdges.id, mergeEdgeId)).limit(1);
    check("merge edge status=applied with snapshot", edgeRow?.status === "applied" && !!edgeRow?.snapshot);

    // ── SPLIT (un-merge) ────────────────────────────────────────────────────
    console.log("\nRunning splitPersons (un-merge)...");
    await splitPersons(mergeEdgeId, null);

    const [absRow2] = await db.select().from(records).where(eq(records.id, absorbed)).limit(1);
    check("absorbed restored (not deleted)", !absRow2?.deletedAt && !absRow2?.mergedIntoRecordId);
    const refBack = await db.select({ ref: recordValues.referencedRecordId }).from(recordValues).where(eq(recordValues.recordId, refHolder.id));
    check("deal reference restored to absorbed", refBack.some((r) => r.ref === absorbed) && !refBack.some((r) => r.ref === survivor));
    const [contactBack] = await db.select({ crm: inboxContacts.crmRecordId }).from(inboxContacts).where(eq(inboxContacts.id, contact.id));
    check("inbox_contact restored to absorbed", contactBack?.crm === absorbed);
    const [identBack] = await db.select({ p: personIdentifiers.personRecordId }).from(personIdentifiers).where(eq(personIdentifiers.id, ident.id));
    check("person_identifier restored to absorbed", identBack?.p === absorbed);
    const survPhones2 = await db.select({ t: recordValues.textValue }).from(recordValues).where(and(eq(recordValues.recordId, survivor), eq(recordValues.attributeId, phoneAttr)));
    check("copied phone removed from survivor on un-merge", !survPhones2.some((p) => p.t === "+49 999 0000002"));
    const [edgeRow2] = await db.select().from(personMergeEdges).where(eq(personMergeEdges.id, mergeEdgeId)).limit(1);
    check("merge edge status=reverted", edgeRow2?.status === "reverted");
  } finally {
    // ── Cleanup: delete every throwaway row (edges before records: FK) ───────
    console.log("\nCleanup: removing all ZZ_TEST data...");
    if (created.edgeIds.length) await db.delete(personMergeEdges).where(inArray(personMergeEdges.id, created.edgeIds));
    if (created.identifierIds.length) await db.delete(personIdentifiers).where(inArray(personIdentifiers.id, created.identifierIds));
    if (created.contactIds.length) await db.delete(inboxContacts).where(inArray(inboxContacts.id, created.contactIds));
    if (created.recordIds.length) {
      await db.delete(activityEvents).where(inArray(activityEvents.recordId, created.recordIds));
      await db.delete(records).where(inArray(records.id, created.recordIds)); // cascades record_values
    }
    console.log("Cleanup done.");
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-merge-prod fatal:", err);
  process.exit(1);
});
