/**
 * Backfill für das Cross-Company-Badge + Namens-Heilung der Inbox-Kontakte.
 *
 * Hintergrund: multi_company_flag wurde historisch nur vom E-Mail-Ingest
 * gesetzt (set-only, ohne Lane-Gate). Ergebnis in Prod: echte Kunden, die
 * beiden Betriebsgesellschaften per WhatsApp schreiben, tragen KEIN Badge —
 * Newsletter-/System-Absender (Kleinanzeigen, PayPal, …), die beide
 * Postfächer anschreiben, tragen eins. Der geteilte Recompute in
 * services/multi-company.ts (Lane-Gate: nur lead/review zählen) läuft jetzt
 * in beiden Ingest-Pfaden; dieses Skript zieht den Bestand einmalig nach:
 *
 *   1. Flag-Recompute für ALLE Kontakte (beide Richtungen: setzen + löschen).
 *      Personen-verknüpfte Kontakte werden personenweit berechnet (inkl.
 *      people-Attribut multi_company_flag), unverknüpfte kontaktweise.
 *   2. Namens-Heilung: Kontakte, deren displayName keinen einzigen Buchstaben
 *      enthält (eingefrorene wa_id/LID-Ziffern), erben den Namen ihrer
 *      verknüpften Person, sofern der Buchstaben enthält.
 *
 * Kontakte, die trotz Recompute geflaggt bleiben, werden mit den Lanes ihrer
 * Konversationen gelistet — bleibt ein System-Absender geflaggt, sind seine
 * Alt-Konversationen noch lane='lead' (Default vor Einführung der Triage):
 * im Inbox-UI auf info/spam stellen und das Skript erneut laufen lassen.
 *
 * DRY-RUN by default — --apply mutiert.
 * Run: pnpm --filter @openclaw-crm/web exec tsx scripts/backfill-multi-company-flags.ts
 */
import "./_load-env";
import { db } from "@/db";
import {
  inboxContacts,
  inboxConversations,
  channelAccounts,
} from "@/db/schema/inbox";
import { objects, attributes, recordValues } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  MULTI_COMPANY_LANES,
  recomputeMultiCompanyForPerson,
} from "@/services/multi-company";

const APPLY = process.argv.includes("--apply");
const log = (...a: unknown[]) => console.log(...a);

const hasLetters = (s: string | null | undefined): boolean =>
  !!s && /\p{L}/u.test(s);

async function main() {
  log(`Multi-Company-Backfill — ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // ── Faktenbasis ────────────────────────────────────────────────────────────
  const contacts = await db
    .select({
      id: inboxContacts.id,
      workspaceId: inboxContacts.workspaceId,
      displayName: inboxContacts.displayName,
      crmRecordId: inboxContacts.crmRecordId,
      flag: inboxContacts.multiCompanyFlag,
    })
    .from(inboxContacts);

  // Lane-gegatete (Kontakt, Betriebsgesellschaft)-Paare in einem Rutsch.
  const pairs = await db
    .selectDistinct({
      contactId: inboxConversations.contactId,
      oc: channelAccounts.operatingCompanyRecordId,
      lane: inboxConversations.lane,
    })
    .from(inboxConversations)
    .innerJoin(
      channelAccounts,
      eq(inboxConversations.channelAccountId, channelAccounts.id)
    )
    .where(sql`${channelAccounts.operatingCompanyRecordId} is not null`);

  const gatedByContact = new Map<string, Set<string>>();
  const allLanesByContact = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.oc) continue;
    if (!allLanesByContact.has(p.contactId))
      allLanesByContact.set(p.contactId, new Set());
    allLanesByContact.get(p.contactId)!.add(p.lane);
    if (!(MULTI_COMPANY_LANES as readonly string[]).includes(p.lane)) continue;
    if (!gatedByContact.has(p.contactId))
      gatedByContact.set(p.contactId, new Set());
    gatedByContact.get(p.contactId)!.add(p.oc);
  }

  // Personenweite Vereinigung über alle Kontakte derselben Person.
  const byPerson = new Map<string, Set<string>>();
  for (const c of contacts) {
    if (!c.crmRecordId) continue;
    const ocs = gatedByContact.get(c.id);
    if (!byPerson.has(c.crmRecordId)) byPerson.set(c.crmRecordId, new Set());
    if (ocs) for (const oc of ocs) byPerson.get(c.crmRecordId)!.add(oc);
  }

  // ── Teil 1: Flag-Diff ─────────────────────────────────────────────────────
  const toSet: typeof contacts = [];
  const toClear: typeof contacts = [];
  const personsToRecompute = new Map<string, string>(); // personId -> workspaceId
  for (const c of contacts) {
    const ocs = c.crmRecordId
      ? (byPerson.get(c.crmRecordId) ?? new Set())
      : (gatedByContact.get(c.id) ?? new Set());
    const expected = ocs.size >= 2;
    if (expected === c.flag) continue;
    (expected ? toSet : toClear).push(c);
    if (c.crmRecordId) personsToRecompute.set(c.crmRecordId, c.workspaceId);
  }

  log(`Kontakte gesamt: ${contacts.length}`);
  log(`Badge zu SETZEN (echte Cross-Company-Kunden): ${toSet.length}`);
  for (const c of toSet) log(`  + ${c.displayName ?? c.id}`);
  log(`Badge zu LÖSCHEN (System-/Newsletter-Absender): ${toClear.length}`);
  for (const c of toClear) {
    const lanes = [...(allLanesByContact.get(c.id) ?? [])].join(",") || "—";
    log(`  - ${c.displayName ?? c.id} (Lanes: ${lanes})`);
  }

  // Geflaggt-bleibende Kontakte mit Lane-Übersicht (Alt-Daten-Drift sichtbar).
  const staysFlagged = contacts.filter(
    (c) => c.flag && !toClear.includes(c) && !toSet.includes(c)
  );
  if (staysFlagged.length > 0) {
    log(`Bleiben geflaggt: ${staysFlagged.length}`);
    for (const c of staysFlagged) {
      const lanes = [...(allLanesByContact.get(c.id) ?? [])].join(",") || "—";
      log(`  = ${c.displayName ?? c.id} (Lanes: ${lanes})`);
    }
  }

  // ── Teil 2: Namens-Heilung ────────────────────────────────────────────────
  const numericContacts = contacts.filter(
    (c) => !hasLetters(c.displayName) && c.crmRecordId
  );
  const heals: Array<{ contactId: string; old: string | null; neu: string }> = [];
  if (numericContacts.length > 0) {
    // people.name-Attribut je Workspace auflösen.
    const wsIds = [...new Set(numericContacts.map((c) => c.workspaceId))];
    const nameAttrByWs = new Map<string, string>();
    for (const ws of wsIds) {
      const [peopleObj] = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.workspaceId, ws), eq(objects.slug, "people")))
        .limit(1);
      if (!peopleObj) continue;
      const [attr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(
          and(eq(attributes.objectId, peopleObj.id), eq(attributes.slug, "name"))
        )
        .limit(1);
      if (attr) nameAttrByWs.set(ws, attr.id);
    }

    const personIds = [
      ...new Set(numericContacts.map((c) => c.crmRecordId!)),
    ];
    const attrIds = [...new Set(nameAttrByWs.values())];
    const nameRows = attrIds.length
      ? await db
          .select({
            recordId: recordValues.recordId,
            value: recordValues.textValue,
          })
          .from(recordValues)
          .where(
            and(
              inArray(recordValues.recordId, personIds),
              inArray(recordValues.attributeId, attrIds)
            )
          )
      : [];
    const nameByPerson = new Map<string, string>();
    for (const r of nameRows) {
      if (r.value && hasLetters(r.value)) nameByPerson.set(r.recordId, r.value);
    }

    for (const c of numericContacts) {
      const personName = nameByPerson.get(c.crmRecordId!);
      if (personName && personName !== c.displayName) {
        heals.push({ contactId: c.id, old: c.displayName, neu: personName });
      }
    }
  }
  log(`\nNamens-Heilung (Ziffern-Name -> Personen-Name): ${heals.length}`);
  for (const h of heals) log(`  ${h.old ?? "∅"} -> ${h.neu}`);
  const unhealable = numericContacts.length - heals.length;
  if (unhealable > 0) {
    log(
      `  (${unhealable} Ziffern-Kontakte ohne heilbaren Personen-Namen — heilen ` +
        `beim nächsten Inbound mit pushName oder via repair-lid-splits)`
    );
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  if (!APPLY) {
    log("\nDRY-RUN — nichts verändert. Mit --apply ausführen.");
    return;
  }

  for (const [personId, ws] of personsToRecompute) {
    await recomputeMultiCompanyForPerson(db, ws, personId);
  }
  const unlinkedChanged = [...toSet, ...toClear].filter((c) => !c.crmRecordId);
  for (const c of unlinkedChanged) {
    await db
      .update(inboxContacts)
      .set({ multiCompanyFlag: !c.flag, updatedAt: new Date() })
      .where(eq(inboxContacts.id, c.id));
  }
  for (const h of heals) {
    await db
      .update(inboxContacts)
      .set({ displayName: h.neu, updatedAt: new Date() })
      .where(eq(inboxContacts.id, h.contactId));
  }
  log(
    `\nAngewendet: ${personsToRecompute.size} Personen-Recomputes, ` +
      `${unlinkedChanged.length} Kontakt-Flags direkt, ${heals.length} Namen geheilt.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-multi-company-flags failed:", err);
    process.exit(1);
  });
