/**
 * Kunde und Adressen eines Deals laden und speichern (Akte „Kunde und
 * Adressen“, Vorprüfung vor KV/AB/RE). Gleicher Speicherweg wie die Akte und
 * PATCH /objects/…/records: `updateRecord` am Lead bzw. an der verknüpften
 * Person, danach die Kalkulation anstoßen. Kein neuer Speicherort, keine Migration.
 *
 * Ohne verknüpfte Person legt das Speichern eines Namens (mit Telefon/E-Mail)
 * eine Person an und verknüpft sie, wie die KI-Übernahme (`applyContactUpdates`):
 * vorher wird über Telefon und E-Mail eine bestehende Person gesucht.
 */
import { canonicalizeEmail, canonicalizePhone, isRelayEmail } from "@/lib/identity/canonical";
import { stripLeadTitleDecorations } from "@/lib/deal-doc-data";
import { nameAusWert } from "@/lib/personen-name";
import {
  KundeFehler,
  nameTeile,
  ortAusTeilen,
  teileAusOrt,
  type DealKunde,
  type KundeEingabe,
} from "@/lib/deal-kunde";

export { KundeFehler };

/** Telefon oder E-Mail gehören schon jemandem: die Oberfläche fragt „verknüpfen oder neue Person?“. */
export class PersonGefunden extends Error {
  constructor(readonly kandidaten: Array<{ personId: string; name: string }>) {
    super(`Es gibt schon ${kandidaten[0]?.name ?? "eine Person"} mit dieser Nummer oder E-Mail.`);
  }
}

type Werte = Record<string, unknown>;

function datumText(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  return m ? m[1] : null;
}

function ersteId(v: unknown): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  if (x && typeof x === "object" && "id" in x && typeof (x as { id: unknown }).id === "string") return (x as { id: string }).id;
  return typeof x === "string" && x ? x : null;
}

function ersterText(v: unknown): string | null {
  const liste = Array.isArray(v) ? v : v == null ? [] : [v];
  for (const x of liste) {
    const t = typeof x === "string" ? x : x && typeof x === "object" && "value" in x ? String((x as { value: unknown }).value) : "";
    if (t.trim()) return t.trim();
  }
  return null;
}

function textListe(v: unknown): string[] {
  const liste = Array.isArray(v) ? v : v == null ? [] : [v];
  return liste.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

async function objekte(ws: string) {
  const { getObjectBySlug } = await import("@/services/objects");
  const [deals, people] = await Promise.all([getObjectBySlug(ws, "deals"), getObjectBySlug(ws, "people")]);
  return { deals, people };
}

/** null, wenn es den Deal in diesem Workspace nicht gibt. */
export async function ladeKunde(ws: string, dealId: string): Promise<DealKunde | null> {
  const { getRecord } = await import("@/services/records");
  const { deals, people } = await objekte(ws);
  if (!deals) return null;
  const deal = await getRecord(deals.id, dealId);
  if (!deal) return null;
  const dv = deal.values as Werte;
  const personId = ersteId(dv.associated_people);
  const person = personId && people ? await getRecord(people.id, personId) : null;
  const pv = (person?.values ?? {}) as Werte;
  const personName = person
    ? typeof pv.name === "string"
      ? pv.name.trim() || null
      : nameAusWert(null, pv.name)
    : null;
  const leadName = stripLeadTitleDecorations(typeof dv.name === "string" ? dv.name : null);
  return {
    personId: person ? personId : null,
    name: personName ?? leadName ?? "",
    nameAusPerson: !!personName,
    telefon: ersterText(pv.phone_numbers),
    email: ersterText(pv.email_addresses),
    auszug: teileAusOrt(dv.move_from_address),
    einzug: teileAusOrt(dv.move_to_address),
    datum: datumText(dv.move_date),
  };
}

/** Neue Angabe vorn, alte bleiben dahinter (nichts geht verloren). */
function vorn(neu: string, alt: string[], gleich: (a: string, b: string) => boolean): string[] {
  return [neu, ...alt.filter((a) => !gleich(a, neu))];
}

const nurZiffern = (s: string) => s.replace(/[^\d+]/g, "");

/**
 * Speichert die gegebenen Felder. Wirft `KundeFehler` (400) bei fehlendem Deal
 * oder wenn Telefon/E-Mail ohne Namen und ohne Person kommen.
 */
/** Speichervorgänge je Deal nacheinander (zwei gleichzeitige sollen nicht zwei Personen anlegen). */
const reihe = new Map<string, Promise<unknown>>();

export function speichereKunde(ws: string, dealId: string, e: KundeEingabe, userId: string | null): Promise<DealKunde> {
  const schluessel = `${ws}:${dealId}`;
  const vorher = reihe.get(schluessel) ?? Promise.resolve();
  const lauf = vorher.catch(() => {}).then(() => speichereKundeJetzt(ws, dealId, e, userId));
  const ende = lauf.catch(() => {});
  reihe.set(schluessel, ende);
  void ende.then(() => {
    if (reihe.get(schluessel) === ende) reihe.delete(schluessel);
  });
  return lauf;
}

async function speichereKundeJetzt(ws: string, dealId: string, e: KundeEingabe, userId: string | null): Promise<DealKunde> {
  const { getRecord, updateRecord, createRecord } = await import("@/services/records");
  const { emitEvent } = await import("@/services/activity-events");
  const { kalkulationAnstossen } = await import("@/services/rechner/ausloeser");
  const { findPersonsByCanonical, upsertIdentifier } = await import("@/services/inbox-crm-link");
  const { deals, people } = await objekte(ws);
  if (!deals) throw new KundeFehler("Deal nicht gefunden.");
  const deal = await getRecord(deals.id, dealId);
  if (!deal) throw new KundeFehler("Deal nicht gefunden.");
  const dv = deal.values as Werte;

  const dealInput: Werte = {};
  if (e.auszug) dealInput.move_from_address = ortAusTeilen(e.auszug);
  if (e.einzug) dealInput.move_to_address = ortAusTeilen(e.einzug);
  if (e.datum) dealInput.move_date = e.datum;

  const kontakt = e.name !== undefined || e.telefon !== undefined || e.email !== undefined;
  const geaendert: string[] = Object.keys(dealInput);
  let personId = ersteId(dv.associated_people);
  const neuerAnker: { telefon?: string; email?: string } = {};
  /** Auf Wahl verknüpfte bestehende Person: wird nie umbenannt, der eingetragene Name geht an den Lead. */
  let bestehendVerknuepft = false;

  if (kontakt) {
    if (!people) throw new KundeFehler("Personen-Objekt fehlt.");
    const person = personId ? await getRecord(people.id, personId) : null;
    if (personId && !person) personId = null;
    const emailCanon = e.email && !isRelayEmail(e.email) ? canonicalizeEmail(e.email) : null;
    const telCanon = e.telefon ? canonicalizePhone(e.telefon) : null;

    if (!personId) {
      // Nie still mit einer bestehenden Person verknüpfen (Review I2): passt Telefon oder E-Mail zu
      // jemandem, fragt die Oberfläche nach. Verknüpft wird nur auf ausdrückliche Wahl, sonst neue Person.
      const treffer = telCanon || emailCanon ? [...new Set(await findPersonsByCanonical(ws, telCanon ? [telCanon] : [], emailCanon))] : [];
      const wahl = e.personWahl;
      if (wahl && wahl !== "neu") {
        if (!treffer.includes(wahl.verknuepfen)) throw new KundeFehler("Diese Person passt nicht zu Telefon oder E-Mail. Bitte neu speichern.");
        personId = wahl.verknuepfen;
        bestehendVerknuepft = true;
        geaendert.push("person_verknuepft");
      } else if (treffer.length > 0 && wahl !== "neu") {
        const kandidaten = await Promise.all(
          treffer.slice(0, 3).map(async (id) => {
            const v = ((await getRecord(people.id, id))?.values ?? {}) as Werte;
            const name = typeof v.name === "string" ? v.name.trim() : nameAusWert(null, v.name) ?? "";
            return { personId: id, name: name || "eine Person ohne Namen" };
          })
        );
        throw new PersonGefunden(kandidaten);
      } else {
        const name = e.name ?? stripLeadTitleDecorations(typeof dv.name === "string" ? dv.name : null);
        if (!name) throw new KundeFehler("Bitte zuerst den Namen eintragen.");
        const neu = await createRecord(people.id, { name: nameTeile(name) }, userId);
        if (!neu) throw new KundeFehler("Person konnte nicht angelegt werden.");
        personId = neu.id;
        geaendert.push("person_angelegt");
      }
      dealInput.associated_people = [personId];
    }

    const aktuell = (personId ? ((await getRecord(people.id, personId))?.values ?? {}) : {}) as Werte;
    const personInput: Werte = {};
    if (e.name !== undefined) {
      const alt = typeof aktuell.name === "string" ? aktuell.name : nameAusWert(null, aktuell.name) ?? "";
      if (bestehendVerknuepft && alt.trim() && alt.trim().toLowerCase() !== e.name.toLowerCase()) {
        // Verknüpfte bestehende Person behält ihren Namen; der eingetragene Name wird nicht verworfen,
        // er steht danach als Lead-Name.
        dealInput.name = e.name;
        geaendert.push("lead_name");
      } else if (alt.trim().toLowerCase() !== e.name.toLowerCase()) {
        personInput.name = nameTeile(e.name);
        // Lead-Titel war der alte Name (z. B. der Anzeigen-Alias): mitziehen, wie die KI-Übernahme.
        const titel = typeof dv.name === "string" ? dv.name.trim() : "";
        if (!titel || titel.toLowerCase() === alt.trim().toLowerCase()) dealInput.name = e.name;
        geaendert.push("name");
      }
    }
    if (e.telefon !== undefined) {
      const alt = textListe(aktuell.phone_numbers);
      if (nurZiffern(alt[0] ?? "") !== nurZiffern(e.telefon)) {
        personInput.phone_numbers = vorn(e.telefon, alt, (a, b) => nurZiffern(a) === nurZiffern(b));
        geaendert.push("telefon");
        neuerAnker.telefon = e.telefon;
      }
    }
    if (e.email !== undefined) {
      const alt = textListe(aktuell.email_addresses);
      if ((alt[0] ?? "").toLowerCase() !== e.email) {
        personInput.email_addresses = vorn(e.email, alt, (a, b) => a.toLowerCase() === b.toLowerCase());
        geaendert.push("email");
        neuerAnker.email = e.email;
      }
    }
    if (personId && Object.keys(personInput).length > 0) {
      await updateRecord(people.id, personId, personInput, userId);
    }
    // Telefon und E-Mail in den Identitätsgraphen, ohne einer anderen Person eine Nummer zu nehmen.
    if (personId) {
      if (neuerAnker.telefon && telCanon) {
        const besitzer = await findPersonsByCanonical(ws, [telCanon], null);
        if (besitzer.length === 0 || besitzer.includes(personId)) {
          await upsertIdentifier(ws, personId, "phone", neuerAnker.telefon, telCanon, "operator", "claimed");
        }
      }
      if (neuerAnker.email && emailCanon) {
        const besitzer = await findPersonsByCanonical(ws, [], emailCanon);
        if (besitzer.length === 0 || besitzer.includes(personId)) {
          await upsertIdentifier(ws, personId, "email", neuerAnker.email, emailCanon, "operator", "claimed");
        }
      }
    }
  }

  if (Object.keys(dealInput).length > 0) {
    await updateRecord(deals.id, dealId, dealInput, userId);
  }
  if (dealInput.move_from_address || dealInput.move_to_address || dealInput.move_date) {
    kalkulationAnstossen(ws, dealId);
  }
  if (geaendert.length > 0) {
    // Nur Feldnamen, keine Werte: das Ereignis sagt, wer wann was ergänzt hat.
    await emitEvent({
      workspaceId: ws,
      recordId: dealId,
      objectSlug: "deals",
      eventType: "deal.kunde_bearbeitet",
      payload: { felder: [...new Set(geaendert.filter((f) => f !== "associated_people"))], quelle: e.quelle ?? "akte" },
      actorId: userId,
    });
  }
  const neu = await ladeKunde(ws, dealId);
  if (!neu) throw new KundeFehler("Deal nicht gefunden.");
  return neu;
}

