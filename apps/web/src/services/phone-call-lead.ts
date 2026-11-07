import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects, phoneCalls, recordValues, records, statuses } from "@/db/schema";
import {
  anrufSperre,
  entscheideAnrufLead,
  istAnrufStatus,
  istOffeneStufe,
  leadsPersonenId,
  sperrSchluessel,
  type AnrufLeadEntscheid,
  type AnrufStatus,
  type LeadWahl,
  type PersonenKarte,
} from "@/lib/phone-call-lead";
import { vorschlaegeAusAnruf } from "@/services/deal-enrichment";
import { stampDealSourceIfEmpty } from "@/services/deal-attribution";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import {
  dealAnlegen,
  kartenFuerNummer,
  nameDerPerson,
  NummerBelegt,
  personAnlegen,
  voraussetzungen,
} from "@/services/lead-anlegen";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

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

class SchonErledigt extends Error {
  constructor() {
    super("erledigt");
  }
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

export async function leadAusAnruf(input: {
  workspaceId: string;
  callId: string;
  name: string | null;
  wahl: LeadWahl | null;
  personId: string | null;
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

      if (anruf.callerE164 && anruf.matchStatus !== "matched") {
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
        personWahl: input.personId,
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
        personWahl: input.personId,
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
        personId = await personAnlegen(tx, {
          workspaceId: input.workspaceId,
          peopleObjectId: basis.peopleId,
          peopleFelder: basis.people,
          name: entscheid.person.name,
          telefonE164: entscheid.telefon,
          telefonRoh: null,
          email: null,
          actorId: input.actorId,
        });
      } else {
        personId = entscheid.person.id;
      }

      let dealId: string;
      if (entscheid.lead.neu) {
        const titel = entscheid.person.neu ? entscheid.person.name : await nameDerPerson(tx, basis.peopleId, personId);
        dealId = await dealAnlegen(tx, {
          dealsObjectId: basis.dealsId,
          dealsFelder: basis.deals,
          stufeId: basis.stufeId,
          name: titel,
          personId,
          actorId: input.actorId,
        });
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
