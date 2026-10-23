import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ATTRIBUTE_TYPE_COLUMN_MAP, type AttributeType } from "@openclaw-crm/shared";
import { db } from "@/db";
import {
  attributes,
  objects,
  personIdentifiers,
  phoneCalls,
  recordValues,
  records,
  statuses,
} from "@/db/schema";
import { extractPersonalName } from "@/lib/display-name";
import {
  anrufSperre,
  entscheideAnrufLead,
  istAnrufStatus,
  istOffeneStufe,
  leadsPersonenId,
  personNameJson,
  sperrSchluessel,
  type AnrufLeadEntscheid,
  type AnrufStatus,
  type LeadWahl,
  type PersonenKarte,
} from "@/lib/phone-call-lead";
import { vorschlaegeAusAnruf } from "@/services/deal-enrichment";
import { stampDealSourceIfEmpty } from "@/services/deal-attribution";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import { livePersonIdsForE164 } from "@/services/phone-calls";
import { neueAnfrageStufeId } from "@/services/stufen-wahl";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

interface Feld {
  id: string;
  type: AttributeType;
}

export interface AnrufListenKontext {
  karten: PersonenKarte[];
  bestehendePerson: PersonenKarte | null;
  offeneLeads: PersonenKarte[];
}

export type LeadAntwort =
  | { art: "fehlt" }
  | { art: "fehler"; meldung: string }
  | { art: "name" }
  | {
      art: "fertig";
      dealRecordId: string;
      personRecordId: string | null;
      matchStatus: AnrufStatus;
    }
  | {
      art: "angelegt";
      dealRecordId: string;
      personRecordId: string;
      matchStatus: AnrufStatus;
      leadNeu: boolean;
    }
  | { art: "konflikt"; meldung: string; karten: PersonenKarte[]; leads: PersonenKarte[] };

class NummerBelegt extends Error {
  constructor(readonly e164: string) {
    super("nummer belegt");
  }
}

class SchonErledigt extends Error {
  constructor() {
    super("erledigt");
  }
}

function istEinmalig(err: unknown): boolean {
  const gesehen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !gesehen.has(cur)) {
    gesehen.add(cur);
    if ("code" in cur && (cur as { code?: string }).code === "23505") return true;
    cur = "cause" in cur ? (cur as { cause?: unknown }).cause : null;
  }
  return false;
}

async function felder(objectId: string): Promise<Map<string, Feld>> {
  const zeilen = await db
    .select({ id: attributes.id, slug: attributes.slug, type: attributes.type })
    .from(attributes)
    .where(eq(attributes.objectId, objectId));
  return new Map(zeilen.map((zeile) => [zeile.slug, { id: zeile.id, type: zeile.type as AttributeType }]));
}

function wertZeile(recordId: string, feld: Feld, value: unknown, actorId: string | null) {
  const spalte = ATTRIBUTE_TYPE_COLUMN_MAP[feld.type];
  const basis = { recordId, attributeId: feld.id, sortOrder: 0, createdBy: actorId };
  if (spalte === "text_value") return { ...basis, textValue: String(value) };
  if (spalte === "json_value") return { ...basis, jsonValue: value };
  if (spalte === "referenced_record_id") {
    const id = String(value);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return { ...basis, referencedRecordId: id };
  }
  return null;
}

async function schreibe(tx: Tx, recordId: string, feld: Feld | undefined, value: unknown, actorId: string | null) {
  if (!feld) return;
  const zeile = wertZeile(recordId, feld, value, actorId);
  if (!zeile) return;
  await tx.insert(recordValues).values(zeile);
}

async function kartenFuerNummer(workspaceId: string, e164: string): Promise<PersonenKarte[]> {
  const ids = await livePersonIdsForE164(workspaceId, e164);
  if (ids.length === 0) return [];
  const namen = await batchGetRecordDisplayNames(ids);
  return ids.map((id) => ({ id, name: namen.get(id)?.displayName || "Kunde" }));
}

async function lebendePerson(tx: Db, workspaceId: string, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const [zeile] = await tx
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, personId),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "people"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  return zeile?.id ?? null;
}

async function nameDerPerson(tx: Db, peopleObjectId: string, personId: string): Promise<string> {
  const [attr] = await tx
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, peopleObjectId), eq(attributes.slug, "name")))
    .limit(1);
  if (!attr) return "Kunde";
  const [wert] = await tx
    .select({ json: recordValues.jsonValue, text: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, personId), eq(recordValues.attributeId, attr.id)))
    .limit(1);
  return extractPersonalName(wert?.json) || wert?.text?.trim() || "Kunde";
}

export async function offeneLeadsDerPerson(
  exec: Db,
  dealsObjectId: string,
  personId: string
): Promise<PersonenKarte[]> {
  const attrZeilen = await exec
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(eq(attributes.objectId, dealsObjectId));
  const nachSlug = new Map(attrZeilen.map((zeile) => [zeile.slug, zeile.id]));
  const verknuepfung = nachSlug.get("associated_people");
  if (!verknuepfung) return [];

  const links = await exec
    .select({ rid: recordValues.recordId })
    .from(recordValues)
    .where(and(eq(recordValues.attributeId, verknuepfung), eq(recordValues.referencedRecordId, personId)));
  const ids = [...new Set(links.map((link) => link.rid))];
  if (ids.length === 0) return [];

  const lebend = await exec
    .select({ id: records.id })
    .from(records)
    .where(and(inArray(records.id, ids), eq(records.objectId, dealsObjectId), isNull(records.deletedAt)))
    .orderBy(desc(records.createdAt));
  if (lebend.length === 0) return [];

  const nameAttr = nachSlug.get("name");
  const stufeAttr = nachSlug.get("stage");
  const attrIds = [nameAttr, stufeAttr].filter((id): id is string => !!id);
  const werte = attrIds.length
    ? await exec
        .select({
          recordId: recordValues.recordId,
          attributeId: recordValues.attributeId,
          text: recordValues.textValue,
        })
        .from(recordValues)
        .where(and(inArray(recordValues.recordId, lebend.map((zeile) => zeile.id)), inArray(recordValues.attributeId, attrIds)))
    : [];

  const stufenIds = stufeAttr
    ? werte.filter((wert) => wert.attributeId === stufeAttr && wert.text).map((wert) => wert.text as string)
    : [];
  const stufenZeilen = stufenIds.length
    ? await exec
        .select({ id: statuses.id, title: statuses.title, stageCategory: statuses.stageCategory })
        .from(statuses)
        .where(inArray(statuses.id, stufenIds))
    : [];
  const stufen = new Map(stufenZeilen.map((zeile) => [zeile.id, zeile]));

  const ergebnis: PersonenKarte[] = [];
  for (const zeile of lebend) {
    const stufeId = stufeAttr
      ? werte.find((wert) => wert.recordId === zeile.id && wert.attributeId === stufeAttr)?.text ?? null
      : null;
    const stufe = stufeId ? stufen.get(stufeId) : null;
    if (!istOffeneStufe(stufe ? { title: stufe.title, stageCategory: stufe.stageCategory } : null)) continue;
    const name =
      (nameAttr
        ? werte.find((wert) => wert.recordId === zeile.id && wert.attributeId === nameAttr)?.text?.trim()
        : "") || "Lead";
    ergebnis.push({ id: zeile.id, name });
  }
  return ergebnis;
}

function konfliktAus(
  entscheid: Extract<AnrufLeadEntscheid, { art: "abbruch" }>
): Extract<LeadAntwort, { art: "konflikt" }> {
  const meldung =
    entscheid.grund === "mehrere_leads"
      ? "Es gibt mehrere offene Leads. Bitte einen auswählen."
      : entscheid.grund === "matched"
        ? "Der Anruf hängt schon an einem Kunden."
        : "Die Nummer gehört zu mehreren Kunden.";
  return { art: "konflikt", meldung, karten: entscheid.karten, leads: entscheid.leads };
}

async function voraussetzungen(workspaceId: string): Promise<
  | {
      ok: true;
      peopleId: string;
      dealsId: string;
      stufeId: string;
      people: Map<string, Feld>;
      deals: Map<string, Feld>;
    }
  | { ok: false; meldung: string }
> {
  const objekte = await db
    .select({ id: objects.id, slug: objects.slug })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), inArray(objects.slug, ["people", "deals"])));
  const peopleId = objekte.find((objekt) => objekt.slug === "people")?.id;
  const dealsId = objekte.find((objekt) => objekt.slug === "deals")?.id;
  if (!peopleId || !dealsId) return { ok: false, meldung: "Personen oder Leads fehlen." };

  const stufeId = await neueAnfrageStufeId(dealsId);
  if (!stufeId) return { ok: false, meldung: "Die Stufe Neue Anfrage fehlt." };
  const [stufe] = await db
    .select({ title: statuses.title, isActive: statuses.isActive })
    .from(statuses)
    .where(eq(statuses.id, stufeId))
    .limit(1);
  if (!stufe?.isActive || !/^neue anfrage$/i.test(stufe.title.trim())) {
    return { ok: false, meldung: "Die Stufe Neue Anfrage fehlt." };
  }

  const [people, deals] = await Promise.all([felder(peopleId), felder(dealsId)]);
  if (!people.get("name") || !deals.get("name") || !deals.get("stage") || !deals.get("associated_people")) {
    return { ok: false, meldung: "Personen oder Leads sind unvollständig." };
  }
  return { ok: true, peopleId, dealsId, stufeId, people, deals };
}

export async function leadAusAnruf(input: {
  workspaceId: string;
  callId: string;
  name: string | null;
  wahl: LeadWahl | null;
  actorId: string | null;
}): Promise<LeadAntwort> {
  const basis = await voraussetzungen(input.workspaceId);
  if (!basis.ok) return { art: "fehler", meldung: basis.meldung };

  try {
    const ergebnis = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${anrufSperre(input.callId)}))`);
      const [anruf] = await tx
        .select({
          id: phoneCalls.id,
          matchStatus: phoneCalls.matchStatus,
          dealRecordId: phoneCalls.dealRecordId,
          personRecordId: phoneCalls.personRecordId,
          callerE164: phoneCalls.callerE164,
          summary: phoneCalls.summary,
          transcript: phoneCalls.transcript,
        })
        .from(phoneCalls)
        .where(and(eq(phoneCalls.id, input.callId), eq(phoneCalls.workspaceId, input.workspaceId)))
        .limit(1);
      if (!anruf) return { art: "fehlt" as const };
      if (!istAnrufStatus(anruf.matchStatus)) return { art: "fehler" as const, meldung: "Der Anrufstatus ist ungültig." };
      if (anruf.dealRecordId) {
        return {
          art: "fertig" as const,
          dealRecordId: anruf.dealRecordId,
          personRecordId: anruf.personRecordId,
          matchStatus: anruf.matchStatus,
        };
      }

      if (anruf.callerE164 && anruf.matchStatus === "unmatched") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${sperrSchluessel(input.workspaceId, anruf.callerE164, anruf.id)}))`
        );
      }

      const personen =
        anruf.callerE164 && anruf.matchStatus !== "no_number"
          ? await kartenFuerNummer(input.workspaceId, anruf.callerE164)
          : [];
      const angehaengtePersonId = await lebendePerson(tx, input.workspaceId, anruf.personRecordId);
      const personFuerLeads = leadsPersonenId({
        matchStatus: anruf.matchStatus,
        dealRecordId: null,
        callerE164: anruf.callerE164,
        personen,
        angehaengtePersonId,
      });
      const offeneLeads = personFuerLeads
        ? await offeneLeadsDerPerson(tx, basis.dealsId, personFuerLeads)
        : [];
      const entscheid = entscheideAnrufLead({
        matchStatus: anruf.matchStatus,
        dealRecordId: null,
        callerE164: anruf.callerE164,
        angehaengtePersonId,
        personen,
        offeneLeads,
        wahl: input.wahl,
        name: input.name,
      });
      if (entscheid.art === "fertig") {
        return {
          art: "fertig" as const,
          dealRecordId: entscheid.dealRecordId,
          personRecordId: anruf.personRecordId,
          matchStatus: anruf.matchStatus,
        };
      }
      if (entscheid.art === "abbruch") return konfliktAus(entscheid);
      if (entscheid.art === "name") return { art: "name" as const };

      let personId: string;
      if (entscheid.person.neu) {
        const [person] = await tx
          .insert(records)
          .values({ objectId: basis.peopleId, createdBy: input.actorId })
          .returning({ id: records.id });
        personId = person.id;
        const nameFeld = basis.people.get("name");
        const nameWert = nameFeld?.type === "text" ? entscheid.person.name : personNameJson(entscheid.person.name);
        await schreibe(tx, personId, nameFeld, nameWert, input.actorId);
        if (entscheid.telefon) {
          await schreibe(tx, personId, basis.people.get("phone_numbers"), entscheid.telefon, input.actorId);
          try {
            await tx.insert(personIdentifiers).values({
              workspaceId: input.workspaceId,
              personRecordId: personId,
              kind: "phone",
              valueRaw: entscheid.telefon,
              valueCanonical: entscheid.telefon,
              source: "operator",
              trust: "claimed",
            });
          } catch (err) {
            if (istEinmalig(err)) throw new NummerBelegt(entscheid.telefon);
            throw err;
          }
        }
      } else {
        personId = entscheid.person.id;
      }

      let dealId: string;
      if (entscheid.lead.neu) {
        const titel = entscheid.person.neu ? entscheid.person.name : await nameDerPerson(tx, basis.peopleId, personId);
        const [lead] = await tx
          .insert(records)
          .values({ objectId: basis.dealsId, createdBy: input.actorId })
          .returning({ id: records.id });
        dealId = lead.id;
        await schreibe(tx, dealId, basis.deals.get("name"), titel, input.actorId);
        await schreibe(tx, dealId, basis.deals.get("stage"), basis.stufeId, input.actorId);
        await schreibe(tx, dealId, basis.deals.get("associated_people"), personId, input.actorId);
      } else {
        dealId = entscheid.lead.id;
      }

      const [geschrieben] = await tx
        .update(phoneCalls)
        .set({
          personRecordId: personId,
          dealRecordId: dealId,
          matchStatus: entscheid.status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(phoneCalls.id, anruf.id),
            eq(phoneCalls.workspaceId, input.workspaceId),
            isNull(phoneCalls.dealRecordId)
          )
        )
        .returning({ id: phoneCalls.id });
      if (!geschrieben) throw new SchonErledigt();

      return {
        art: "angelegt" as const,
        dealRecordId: dealId,
        personRecordId: personId,
        matchStatus: entscheid.status,
        leadNeu: entscheid.lead.neu,
        summary: anruf.summary,
        transcript: anruf.transcript,
      };
    });

    if (ergebnis.art === "angelegt" && ergebnis.leadNeu) {
      await stampDealSourceIfEmpty({ dealRecordId: ergebnis.dealRecordId, sourceTitle: "Telefon" });
    }
    if (ergebnis.art === "angelegt" && (ergebnis.summary || ergebnis.transcript)) {
      const hinweis = {
        workspaceId: input.workspaceId,
        dealRecordId: ergebnis.dealRecordId,
        callId: input.callId,
        summary: ergebnis.summary,
        transcript: ergebnis.transcript,
      };
      void Promise.resolve()
        .then(() => vorschlaegeAusAnruf(hinweis))
        .catch((err) => {
          console.error("[anruf-lead] Vorschläge", err instanceof Error ? err.message : "fehler");
        });
    }
    if (ergebnis.art === "angelegt") {
      return {
        art: "angelegt",
        dealRecordId: ergebnis.dealRecordId,
        personRecordId: ergebnis.personRecordId,
        matchStatus: ergebnis.matchStatus,
        leadNeu: ergebnis.leadNeu,
      };
    }
    return ergebnis;
  } catch (err) {
    if (err instanceof NummerBelegt) {
      const karten = await kartenFuerNummer(input.workspaceId, err.e164);
      return { art: "konflikt", meldung: "Die Nummer gehört schon zu einem Kunden.", karten, leads: [] };
    }
    if (err instanceof SchonErledigt) {
      const [nochmal] = await db
        .select({
          dealRecordId: phoneCalls.dealRecordId,
          personRecordId: phoneCalls.personRecordId,
          matchStatus: phoneCalls.matchStatus,
        })
        .from(phoneCalls)
        .where(and(eq(phoneCalls.id, input.callId), eq(phoneCalls.workspaceId, input.workspaceId)))
        .limit(1);
      if (nochmal?.dealRecordId && istAnrufStatus(nochmal.matchStatus)) {
        return {
          art: "fertig",
          dealRecordId: nochmal.dealRecordId,
          personRecordId: nochmal.personRecordId,
          matchStatus: nochmal.matchStatus,
        };
      }
      return { art: "konflikt", meldung: "Der Anruf wurde gerade anders zugeordnet.", karten: [], leads: [] };
    }
    throw err;
  }
}

export async function kontextFuerAnrufe(
  workspaceId: string,
  zeilen: {
    id: string;
    matchStatus: string;
    dealRecordId: string | null;
    personRecordId: string | null;
    callerE164: string | null;
  }[]
): Promise<Map<string, AnrufListenKontext>> {
  const leer = (): AnrufListenKontext => ({ karten: [], bestehendePerson: null, offeneLeads: [] });
  const ergebnis = new Map<string, AnrufListenKontext>();
  const nummern = new Map<string, PersonenKarte[]>();

  async function karten(e164: string): Promise<PersonenKarte[]> {
    const vorhanden = nummern.get(e164);
    if (vorhanden) return vorhanden;
    const geladen = await kartenFuerNummer(workspaceId, e164);
    nummern.set(e164, geladen);
    return geladen;
  }

  const [deals] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);

  const leadsJePerson = new Map<string, PersonenKarte[]>();
  async function leads(personId: string): Promise<PersonenKarte[]> {
    const vorhanden = leadsJePerson.get(personId);
    if (vorhanden) return vorhanden;
    const geladen = deals ? await offeneLeadsDerPerson(db, deals.id, personId) : [];
    leadsJePerson.set(personId, geladen);
    return geladen;
  }

  for (const zeile of zeilen) {
    const hinweis = leer();
    if (zeile.dealRecordId) {
      ergebnis.set(zeile.id, hinweis);
      continue;
    }
    if (zeile.matchStatus === "ambiguous" && zeile.callerE164) {
      hinweis.karten = await karten(zeile.callerE164);
    } else if (zeile.matchStatus === "unmatched" && zeile.callerE164) {
      const treffer = await karten(zeile.callerE164);
      if (treffer.length >= 2) hinweis.karten = treffer;
      else if (treffer.length === 1) hinweis.bestehendePerson = treffer[0];
    }
    if (!hinweis.bestehendePerson && zeile.personRecordId && (zeile.matchStatus === "unmatched" || zeile.matchStatus === "no_number")) {
      const lebt = await lebendePerson(db, workspaceId, zeile.personRecordId);
      if (lebt) {
        const namen = await batchGetRecordDisplayNames([lebt]);
        hinweis.bestehendePerson = { id: lebt, name: namen.get(lebt)?.displayName || "Kunde" };
      }
    }
    if (hinweis.bestehendePerson) hinweis.offeneLeads = await leads(hinweis.bestehendePerson.id);
    ergebnis.set(zeile.id, hinweis);
  }
  return ergebnis;
}
