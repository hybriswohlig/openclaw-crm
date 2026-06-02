/**
 * Rescue phone numbers from OLD Kleinanzeigen emails (KOT-IDENTITY follow-up).
 * The "(Tel.: ...)" line was stripped from the cleaned body but survives in the
 * stored body_html. We re-parse it, canonicalize the phone, and:
 *   - if that number already belongs to ANOTHER person (e.g. their WhatsApp),
 *     deterministically MERGE the two (a real shared phone = same human),
 *   - else attach the phone identifier to the KA person so a future WhatsApp
 *     message on that number resolves to them.
 * DRY-RUN by default; --apply to perform. Merges go through mergePersons
 * (snapshot + reversible).
 *
 * Run: NODE_ENV=production DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/rescue-ka-phones.ts [--apply]
 */
import { db } from "@/db";
import { objects, records, inboxContacts, inboxConversations, inboxMessages, personIdentifiers } from "@/db/schema";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { canonicalizePhone } from "@/lib/identity/canonical";
import { mergePersons } from "@/services/person-merge";

const APPLY = process.argv.includes("--apply");
const TEL_RE = /Tel\.?:\s*([0-9 ()/.+\-]{6,})/gi;

function extractTelPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TEL_RE)) {
    const c = canonicalizePhone(m[1]);
    if (c) out.add(c);
  }
  return [...out];
}

async function main() {
  console.log(`\n=== Rescue KA phones — ${APPLY ? "APPLY" : "DRY-RUN"} ===`);
  const wss = await db.select({ id: objects.workspaceId }).from(objects).groupBy(objects.workspaceId);
  let rescued = 0, merges = 0, attached = 0;
  const mergeLog: string[] = [];

  for (const { id: workspaceId } of [...new Map(wss.map((w) => [w.id, w])).values()]) {
    const kaContacts = await db
      .select({ id: inboxContacts.id, crm: inboxContacts.crmRecordId })
      .from(inboxContacts)
      .where(and(eq(inboxContacts.workspaceId, workspaceId)));
    for (const kc of kaContacts) {
      if (!kc.crm) continue;
      // is this a Kleinanzeigen contact? (relay email or KA conversation)
      const convs = await db.select({ id: inboxConversations.id, ext: inboxConversations.externalThreadId }).from(inboxConversations).where(eq(inboxConversations.contactId, kc.id));
      const isKa = convs.some((c) => c.ext && /@mail\.kleinanzeigen\.de$/i.test(c.ext));
      if (!isKa || convs.length === 0) continue;
      // ensure the KA person is still live
      const [person] = await db.select({ id: records.id, deletedAt: records.deletedAt, createdAt: records.createdAt }).from(records).where(eq(records.id, kc.crm)).limit(1);
      if (!person || person.deletedAt) continue;

      const msgs = await db.select({ body: inboxMessages.body, bodyHtml: inboxMessages.bodyHtml }).from(inboxMessages).where(and(inArray(inboxMessages.conversationId, convs.map((c) => c.id)), eq(inboxMessages.direction, "inbound")));
      const phones = new Set<string>();
      for (const m of msgs) {
        for (const p of extractTelPhones(`${m.body ?? ""}\n${m.bodyHtml ?? ""}`)) phones.add(p);
      }
      if (phones.size === 0) continue;

      for (const phone of phones) {
        rescued++;
        // does this canonical phone already belong to another person?
        const [other] = await db
          .select({ pid: personIdentifiers.personRecordId })
          .from(personIdentifiers)
          .where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.kind, "phone"), eq(personIdentifiers.valueCanonical, phone), ne(personIdentifiers.personRecordId, kc.crm)))
          .limit(1);
        if (other) {
          // verify the other person is live; pick the older as survivor
          const [op] = await db.select({ id: records.id, deletedAt: records.deletedAt, createdAt: records.createdAt }).from(records).where(eq(records.id, other.pid)).limit(1);
          if (!op || op.deletedAt) continue;
          const survivor = (person.createdAt <= op.createdAt) ? kc.crm : other.pid;
          const absorbed = survivor === kc.crm ? other.pid : kc.crm;
          merges++;
          mergeLog.push(`merge ${survivor.slice(0, 8)} <- ${absorbed.slice(0, 8)}  [phone ${phone}]`);
          if (APPLY) {
            await mergePersons({ workspaceId, survivorId: survivor, absorbedId: absorbed, method: "deterministic", confidence: 1, evidence: { reason: "KA Tel.-rescue: shared phone with another person", phone } });
          }
          break; // person resolved
        } else {
          attached++;
          if (APPLY) {
            const [ex] = await db.select({ id: personIdentifiers.id }).from(personIdentifiers).where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.kind, "phone"), eq(personIdentifiers.valueCanonical, phone))).limit(1);
            if (!ex) await db.insert(personIdentifiers).values({ workspaceId, personRecordId: kc.crm, kind: "phone", valueRaw: phone, valueCanonical: phone, source: "kleinanzeigen", trust: "claimed" });
          }
        }
      }
    }
  }

  console.log(`\nKA phones rescued: ${rescued}`);
  console.log(`  -> deterministic merges (shared phone with another person): ${merges}`);
  console.log(`  -> phone attached to KA person (no match yet): ${attached}`);
  if (mergeLog.length) { console.log(`\nmerges:`); for (const l of mergeLog.slice(0, 30)) console.log("  " + l); }
  console.log(`\n${APPLY ? "APPLIED." : "DRY-RUN — nothing changed. Re-run with --apply."}\n`);
  process.exit(0);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
