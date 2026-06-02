/**
 * Phase 1 identity backfill (KOT-IDENTITY). DRY-RUN by default — pass --apply to
 * mutate. Reversible: people merges go through mergePersons (snapshot + splittable),
 * canonical columns + identifiers are additive (can be nulled/deleted).
 *
 * Steps:
 *   A. Populate inbox_contacts.{phone,email}_canonical (skip cross-contact collisions).
 *   B. Seed person_identifiers from existing people, deterministically MERGING any
 *      people that share a canonical hard key (E.164 phone / lowercased email).
 *   C. Fix the name JSON-key bug (fullName -> full_name).
 *   D/E. Report-only: rescuable KA phones, bot-as-person contacts, duplicate channels.
 *
 * Run dry-run:  NODE_ENV=production DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/backfill-identity.ts
 * Run apply:    ... tsx scripts/backfill-identity.ts --apply
 */
import { db } from "@/db";
import { objects, attributes, records, recordValues, inboxContacts, inboxConversations, channelAccounts, personIdentifiers } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { canonicalizePhone, canonicalizeEmail, isRelayEmail } from "@/lib/identity/canonical";
import { mergePersons } from "@/services/person-merge";

const APPLY = process.argv.includes("--apply");
const log = (s: string) => console.log(s);
const section = (s: string) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

async function main() {
  log(`\n=== Identity backfill — ${APPLY ? "APPLY (mutating)" : "DRY-RUN (no changes)"} ===`);
  const wss = await db.select({ id: objects.workspaceId }).from(objects).groupBy(objects.workspaceId);
  const workspaceIds = [...new Set(wss.map((w) => w.id))];

  const totals = { canonSet: 0, canonCollisions: 0, identifiersSeeded: 0, peopleMerged: 0 };

  for (const workspaceId of workspaceIds) {
    const [peopleObj] = await db.select({ id: objects.id }).from(objects).where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people"))).limit(1);
    if (!peopleObj) continue;
    const attrRows = await db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, peopleObj.id));
    const attr = (s: string) => attrRows.find((a) => a.slug === s)?.id ?? null;
    const phoneAttr = attr("phone_numbers");
    const emailAttr = attr("email_addresses");
    const nameAttr = attr("name");

    // ── Step A: canonical columns on inbox_contacts ──────────────────────────
    section("A. inbox_contacts canonical keys");
    const contacts = await db.select({ id: inboxContacts.id, email: inboxContacts.email, phone: inboxContacts.phone, pc: inboxContacts.phoneCanonical, ec: inboxContacts.emailCanonical }).from(inboxContacts).where(eq(inboxContacts.workspaceId, workspaceId));
    const phoneOwners = new Map<string, string>(); // canon -> contactId (first)
    const emailOwners = new Map<string, string>();
    for (const c of contacts) {
      const pc = canonicalizePhone(c.phone);
      const ec = canonicalizeEmail(c.email);
      for (const [val, owners, kind] of [[pc, phoneOwners, "phone"], [ec, emailOwners, "email"]] as const) {
        if (!val) continue;
        if (owners.has(val) && owners.get(val) !== c.id) { totals.canonCollisions++; continue; }
        owners.set(val, c.id);
        const already = kind === "phone" ? c.pc : c.ec;
        if (already === val) continue;
        totals.canonSet++;
        if (APPLY) {
          await db.update(inboxContacts).set(kind === "phone" ? { phoneCanonical: val } : { emailCanonical: val }).where(eq(inboxContacts.id, c.id));
        }
      }
    }
    log(`  contacts: ${contacts.length}, canonical values to set: ${totals.canonSet}, cross-contact collisions skipped: ${totals.canonCollisions}`);

    // ── Step B: seed person_identifiers + merge hard-key duplicate people ─────
    section("B. person_identifiers seeding + hard-key people merge");
    const peopleRecs = await db.select({ id: records.id, createdAt: records.createdAt }).from(records).where(and(eq(records.objectId, peopleObj.id), isNull(records.deletedAt))).orderBy(records.createdAt);
    const peopleIds = peopleRecs.map((r) => r.id);
    const valRows = peopleIds.length ? await db.select({ recordId: recordValues.recordId, attributeId: recordValues.attributeId, textValue: recordValues.textValue }).from(recordValues).where(inArray(recordValues.recordId, peopleIds)) : [];
    const phonesByPerson = new Map<string, Set<string>>();
    const emailsByPerson = new Map<string, Set<string>>();
    const relaysByPerson = new Map<string, Set<string>>();
    for (const v of valRows) {
      if (!v.textValue) continue;
      if (phoneAttr && v.attributeId === phoneAttr) {
        const c = canonicalizePhone(v.textValue);
        if (c) (phonesByPerson.get(v.recordId) ?? phonesByPerson.set(v.recordId, new Set()).get(v.recordId)!).add(c);
      } else if (emailAttr && v.attributeId === emailAttr) {
        if (isRelayEmail(v.textValue)) {
          (relaysByPerson.get(v.recordId) ?? relaysByPerson.set(v.recordId, new Set()).get(v.recordId)!).add(v.textValue.trim());
        } else {
          const c = canonicalizeEmail(v.textValue);
          if (c) (emailsByPerson.get(v.recordId) ?? emailsByPerson.set(v.recordId, new Set()).get(v.recordId)!).add(c);
        }
      }
    }

    const merged = new Set<string>(); // absorbed person ids this run
    const owner = new Map<string, string>(); // "kind:canon" -> survivor person id
    const mergePairs: Array<{ survivor: string; absorbed: string; key: string }> = [];
    for (const person of peopleRecs) {
      if (merged.has(person.id)) continue;
      const keys: string[] = [];
      for (const p of phonesByPerson.get(person.id) ?? []) keys.push(`phone:${p}`);
      for (const e of emailsByPerson.get(person.id) ?? []) keys.push(`email:${e}`);
      let absorbedInto: string | null = null;
      for (const key of keys) {
        const existing = owner.get(key);
        if (existing && existing !== person.id) { absorbedInto = existing; mergePairs.push({ survivor: existing, absorbed: person.id, key }); break; }
      }
      if (absorbedInto) {
        merged.add(person.id);
        totals.peopleMerged++;
        if (APPLY) {
          await mergePersons({ workspaceId, survivorId: absorbedInto, absorbedId: person.id, method: "deterministic", confidence: 1, evidence: { reason: "backfill hard-key dedup" } });
        }
        // survivor now owns this person's keys
        for (const key of keys) if (!owner.has(key)) owner.set(key, absorbedInto);
      } else {
        for (const key of keys) if (!owner.has(key)) owner.set(key, person.id);
      }
    }

    // Seed identifiers for the surviving people (skip ones merged away this run).
    if (APPLY) {
      for (const person of peopleRecs) {
        if (merged.has(person.id)) continue;
        for (const p of phonesByPerson.get(person.id) ?? []) await seedIdentifier(workspaceId, person.id, "phone", p, p);
        for (const e of emailsByPerson.get(person.id) ?? []) await seedIdentifier(workspaceId, person.id, "email", e, e);
        for (const r of relaysByPerson.get(person.id) ?? []) await seedIdentifier(workspaceId, person.id, "ka_relay_email", r, null);
      }
    } else {
      // dry-run count
      for (const person of peopleRecs) {
        if (merged.has(person.id)) continue;
        totals.identifiersSeeded += (phonesByPerson.get(person.id)?.size ?? 0) + (emailsByPerson.get(person.id)?.size ?? 0) + (relaysByPerson.get(person.id)?.size ?? 0);
      }
    }
    log(`  live people: ${peopleRecs.length}, hard-key duplicate merges: ${totals.peopleMerged}, identifiers ${APPLY ? "seeded" : "to seed"}: ${totals.identifiersSeeded || "(seeded in apply)"}`);
    if (mergePairs.length) { log("  merge pairs (survivor <- absorbed, key):"); for (const m of mergePairs.slice(0, 10)) log(`    ${m.survivor.slice(0, 8)} <- ${m.absorbed.slice(0, 8)}  [${m.key}]`); }

    // ── Step C: name keys — REPORT ONLY, intentionally NOT changed ────────────
    // The 'fullName' (camelCase) vs 'full_name' (snake) inconsistency does NOT
    // break display: extractPersonalName reads fullName, then falls back to
    // first_name/last_name. Identity matching uses phone/email canonical, never
    // the name. Rewriting fullName-only records to snake would BLANK them, so we
    // deliberately leave names untouched.
    section("C. name keys (report only — intentionally not changed)");
    void nameAttr;
    log("  name JSON-key inconsistency does not affect display or matching; left as-is.");

    // ── Step D/E: report-only ────────────────────────────────────────────────
    section("D/E. report-only (not changed by this backfill)");
    const botContacts = await db.select({ id: inboxContacts.id, name: inboxContacts.displayName, email: inboxContacts.email, n: sql<number>`count(${inboxConversations.id})` }).from(inboxContacts).leftJoin(inboxConversations, eq(inboxConversations.contactId, inboxContacts.id)).where(and(eq(inboxContacts.workspaceId, workspaceId), sql`(${inboxContacts.email} ilike 'no-reply@%' or ${inboxContacts.email} ilike 'noreply@%' or ${inboxContacts.displayName} in ('Kleinanzeigen','Google','AliExpress','Facebook','Kleinanzeigen PRO'))`)).groupBy(inboxContacts.id, inboxContacts.displayName, inboxContacts.email).orderBy(sql`count(${inboxConversations.id}) desc`).limit(8);
    log("  bot/platform-as-person contacts (handle later via noise triage, Phase 6):");
    for (const b of botContacts) log(`    "${b.name}" <${b.email}>  ${b.n} conversations`);
    const dupChannels = await db.execute(sql`select regexp_replace(address,'[^0-9]','','g') as digits, count(*) c, string_agg(name, ' | ') names from channel_accounts where workspace_id=${workspaceId} and channel_type='whatsapp' group by 1 having count(*) > 1`);
    const dupRows = (dupChannels as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (dupChannels as unknown as Array<Record<string, unknown>>);
    log(`  duplicate WhatsApp channel accounts (same number): ${Array.isArray(dupRows) ? dupRows.length : 0}`);
    if (Array.isArray(dupRows)) for (const d of dupRows) log(`    ${d.digits}: ${d.names}`);
  }

  section("SUMMARY");
  log(`  canonical values set:      ${totals.canonSet}`);
  log(`  contact collisions skipped:${totals.canonCollisions}`);
  log(`  hard-key people merges:    ${totals.peopleMerged}`);
  log(`\n${APPLY ? "APPLIED." : "DRY-RUN complete — nothing changed. Re-run with --apply to perform."}\n`);
  process.exit(0);
}

async function seedIdentifier(workspaceId: string, personRecordId: string, kind: "phone" | "email" | "ka_relay_email", valueRaw: string, valueCanonical: string | null) {
  if (valueCanonical) {
    const [ex] = await db.select({ id: personIdentifiers.id }).from(personIdentifiers).where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.kind, kind), eq(personIdentifiers.valueCanonical, valueCanonical))).limit(1);
    if (ex) return;
  } else {
    const [ex] = await db.select({ id: personIdentifiers.id }).from(personIdentifiers).where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.personRecordId, personRecordId), eq(personIdentifiers.kind, kind), eq(personIdentifiers.valueRaw, valueRaw))).limit(1);
    if (ex) return;
  }
  await db.insert(personIdentifiers).values({ workspaceId, personRecordId, kind, valueRaw, valueCanonical, source: "import", trust: "claimed" });
}

main().catch((e) => { console.error("backfill fatal:", e); process.exit(1); });
