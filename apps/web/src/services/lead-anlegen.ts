import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ATTRIBUTE_TYPE_COLUMN_MAP, type AttributeType } from "@openclaw-crm/shared";
import { db } from "@/db";
import { attributes, objects, personIdentifiers, recordValues, records, selectOptions, statuses } from "@/db/schema";
import { extractPersonalName } from "@/lib/display-name";
import { neuerLeadEntscheid, type NeuerLeadAntwort, type NeuerLeadEingabe } from "@/lib/handy-links";
import { canonicalizePhone } from "@/lib/identity/canonical";
import { personNameJson, sperrSchluessel, type PersonenKarte } from "@/lib/phone-call-lead";
import { assignDealNumber } from "@/services/financial";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import { livePersonIdsForE164 } from "@/services/phone-calls";
import { neueAnfrageStufeId } from "@/services/stufen-wahl";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

export interface LeadFeld {
  id: string;
  type: AttributeType;
}

export class NummerBelegt extends Error {
  constructor(readonly e164: string) {
    super("nummer belegt");
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

async function felder(objectId: string): Promise<Map<string, LeadFeld>> {
  const zeilen = await db
    .select({ id: attributes.id, slug: attributes.slug, type: attributes.type })
    .from(attributes)
    .where(eq(attributes.objectId, objectId));
  return new Map(zeilen.map((zeile) => [zeile.slug, { id: zeile.id, type: zeile.type as AttributeType }]));
}

function wertZeile(recordId: string, feld: LeadFeld, value: unknown, actorId: string | null) {
  const spalte = ATTRIBUTE_TYPE_COLUMN_MAP[feld.type];
  const basis = { recordId, attributeId: feld.id, sortOrder: 0, createdBy: actorId };
  if (spalte === "text_value") return { ...basis, textValue: String(value) };
  if (spalte === "json_value") return { ...basis, jsonValue: value };
  if (spalte === "date_value") return { ...basis, dateValue: String(value) };
  if (spalte === "timestamp_value") {
    return { ...basis, timestampValue: value instanceof Date ? value : new Date(String(value)) };
  }
  if (spalte === "referenced_record_id") {
    const id = String(value);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return { ...basis, referencedRecordId: id };
  }
  return null;
}

async function schreibe(tx: Tx, recordId: string, feld: LeadFeld | undefined, value: unknown, actorId: string | null) {
  if (!feld) return;
  const zeile = wertZeile(recordId, feld, value, actorId);
  if (!zeile) return;
  await tx.insert(recordValues).values(zeile);
}

/** Dieselbe Options-Id, die `stampDealSourceIfEmpty` zum Titel speichert. */
async function optionZumTitel(tx: Tx, attributeId: string, titel: string): Promise<string | null> {
  const [option] = await tx
    .select({ id: selectOptions.id })
    .from(selectOptions)
    .where(and(eq(selectOptions.attributeId, attributeId), sql`lower(${selectOptions.title}) = ${titel.trim().toLowerCase()}`))
    .limit(1);
  return option?.id ?? null;
}

export async function kartenFuerNummer(workspaceId: string, e164: string): Promise<PersonenKarte[]> {
  const ids = await livePersonIdsForE164(workspaceId, e164);
  if (ids.length === 0) return [];
  const namen = await batchGetRecordDisplayNames(ids);
  return ids.map((id) => ({ id, name: namen.get(id)?.displayName || "Kunde" }));
}

export async function nameDerPerson(tx: Db, peopleObjectId: string, personId: string): Promise<string> {
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

export async function voraussetzungen(workspaceId: string): Promise<
  | {
      ok: true;
      peopleId: string;
      dealsId: string;
      stufeId: string;
      people: Map<string, LeadFeld>;
      deals: Map<string, LeadFeld>;
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

export async function personAnlegen(
  tx: Tx,
  e: {
    workspaceId: string;
    peopleObjectId: string;
    peopleFelder: Map<string, LeadFeld>;
    name: string;
    telefonE164: string | null;
    telefonRoh: string | null;
    email: string | null;
    actorId: string | null;
  }
): Promise<string> {
  const [person] = await tx
    .insert(records)
    .values({ objectId: e.peopleObjectId, createdBy: e.actorId })
    .returning({ id: records.id });
  const personId = person.id;
  const nameFeld = e.peopleFelder.get("name");
  const nameWert = nameFeld?.type === "text" ? e.name : personNameJson(e.name);
  await schreibe(tx, personId, nameFeld, nameWert, e.actorId);
  const nummer = e.telefonE164 ?? e.telefonRoh;
  if (nummer) {
    await schreibe(tx, personId, e.peopleFelder.get("phone_numbers"), nummer, e.actorId);
  }
  if (e.telefonE164) {
    try {
      await tx.insert(personIdentifiers).values({
        workspaceId: e.workspaceId,
        personRecordId: personId,
        kind: "phone",
        valueRaw: e.telefonE164,
        valueCanonical: e.telefonE164,
        source: "operator",
        trust: "claimed",
      });
    } catch (err) {
      if (istEinmalig(err)) throw new NummerBelegt(e.telefonE164);
      throw err;
    }
  }
  if (e.email) {
    await schreibe(tx, personId, e.peopleFelder.get("email_addresses"), e.email, e.actorId);
  }
  return personId;
}

export async function dealAnlegen(
  tx: Tx,
  e: {
    dealsObjectId: string;
    dealsFelder: Map<string, LeadFeld>;
    stufeId: string;
    name: string;
    personId: string;
    actorId: string | null;
    quelle?: string;
    firmaId?: string | null;
    umzugsdatum?: string | null;
    quelleZeit?: Date;
  }
): Promise<string> {
  const [lead] = await tx
    .insert(records)
    .values({ objectId: e.dealsObjectId, createdBy: e.actorId })
    .returning({ id: records.id });
  const dealId = lead.id;
  await schreibe(tx, dealId, e.dealsFelder.get("name"), e.name, e.actorId);
  await schreibe(tx, dealId, e.dealsFelder.get("stage"), e.stufeId, e.actorId);
  await schreibe(tx, dealId, e.dealsFelder.get("associated_people"), e.personId, e.actorId);
  if (e.quelle) {
    const feld = e.dealsFelder.get("source_channel");
    if (feld) {
      const optionId = await optionZumTitel(tx, feld.id, e.quelle);
      if (optionId) await schreibe(tx, dealId, feld, optionId, e.actorId);
    }
  }
  if (e.quelleZeit) {
    await schreibe(tx, dealId, e.dealsFelder.get("source_received_at"), e.quelleZeit, e.actorId);
  }
  if (e.firmaId) {
    await schreibe(tx, dealId, e.dealsFelder.get("operating_company"), e.firmaId, e.actorId);
  }
  if (e.umzugsdatum) {
    await schreibe(tx, dealId, e.dealsFelder.get("move_date"), e.umzugsdatum, e.actorId);
  }
  return dealId;
}

async function firmaImWorkspace(workspaceId: string, firmaId: string): Promise<boolean> {
  const [zeile] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, firmaId),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "operating_companies"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  return !!zeile;
}

export async function neuenLeadAnlegen(
  workspaceId: string,
  e: NeuerLeadEingabe,
  actorId: string | null
): Promise<NeuerLeadAntwort | { ok: false; code: "FIRMA" } | { ok: false; code: "FEHLER"; meldung: string }> {
  const basis = await voraussetzungen(workspaceId);
  if (!basis.ok) return { ok: false, code: "FEHLER", meldung: basis.meldung };
  if (!(await firmaImWorkspace(workspaceId, e.firmaId))) return { ok: false, code: "FIRMA" };

  const e164 = canonicalizePhone(e.telefon);
  try {
    const angelegt = await db.transaction(async (tx) => {
      if (e164) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sperrSchluessel(workspaceId, e164, "neuer-lead")}))`);
      }
      const treffer = e164 ? await kartenFuerNummer(workspaceId, e164) : [];
      const entscheid = neuerLeadEntscheid(treffer, e.personWahl);
      if (entscheid.art === "rueckfrage") return { art: "rueckfrage" as const, treffer: entscheid.treffer };

      const personId = entscheid.person.neu
        ? await personAnlegen(tx, {
            workspaceId,
            peopleObjectId: basis.peopleId,
            peopleFelder: basis.people,
            name: e.name,
            // Wählt ein Mensch „Neue Person“ trotz Treffern, teilen sich zwei Personen die
            // Nummer (etwa in einer Familie). Der Schlüssel der Nummer gehört schon der
            // anderen Person; die neue bekommt die Nummer nur als Feld.
            telefonE164: treffer.length === 0 ? e164 : null,
            telefonRoh: treffer.length === 0 ? (e164 ? null : e.telefon) : (e164 ?? e.telefon),
            email: e.email,
            actorId,
          })
        : entscheid.person.id;
      const name = entscheid.person.neu ? e.name : await nameDerPerson(tx, basis.peopleId, personId);
      const dealId = await dealAnlegen(tx, {
        dealsObjectId: basis.dealsId,
        dealsFelder: basis.deals,
        stufeId: basis.stufeId,
        name,
        personId,
        actorId,
        quelle: e.quelle,
        firmaId: e.firmaId,
        umzugsdatum: e.umzugsdatum,
        quelleZeit: new Date(),
      });
      return { art: "angelegt" as const, dealId, personId };
    });

    if (angelegt.art === "rueckfrage") return { ok: false, code: "RUECKFRAGE", treffer: angelegt.treffer };
    try {
      await assignDealNumber(workspaceId, angelegt.dealId);
    } catch (err) {
      // Person und Deal stehen schon. Ein 500 würde zum erneuten Absenden und damit zu
      // einem zweiten Deal verleiten; die Nummer lässt sich nachziehen.
      console.error("[neuer-lead] Dealnummer fehlt", angelegt.dealId, err instanceof Error ? err.message : "fehler");
    }
    return { ok: true, dealRecordId: angelegt.dealId, personRecordId: angelegt.personId };
  } catch (err) {
    if (err instanceof NummerBelegt && e164) {
      const treffer = await kartenFuerNummer(workspaceId, e164);
      return { ok: false, code: "RUECKFRAGE", treffer };
    }
    throw err;
  }
}
