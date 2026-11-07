/**
 * Reine Logik des Dialogs „Zuordnen“ auf der Seite Anrufe (Plan 10,
 * Entscheidung 11): Körper für `POST /api/v1/phone-calls/{callId}/lead` je
 * Lage, Folge einer 409-Antwort, Auswertung der Antwort. Mensch entscheidet:
 * `personId` nur aus den Treffern, `dealId` nur aus den offenen Leads.
 */
import type { AnrufDialogLage, AnrufLeadKoerper, Karte } from "@/lib/handy-links";
import { leadNameAusDialog } from "@/lib/phone-call-lead";

export interface ZuordnenEingabe {
  /** Gewählter Kunde bei `person_waehlen`. */
  personId: string | null;
  /** Gewählter Lead bei `lead_waehlen`: Kennung oder „neu“. */
  lead: string | null;
  /** Name bei `neuer_lead` ohne Person. */
  name: string;
}

export const ZUORDNEN_TEXT = {
  person: "Bitte einen Kunden wählen.",
  lead: "Bitte einen Lead wählen oder „Neuer Lead“.",
  name: "Bitte einen Namen eintragen, 2 bis 120 Zeichen, nicht nur Ziffern.",
  keiner: "Dieser Anruf lässt sich hier nicht zuordnen.",
} as const;

export type ZuordnenKoerper = { ok: true; koerper: AnrufLeadKoerper } | { ok: false; text: string };

/**
 * Körper der Anfrage. `gewaehltePerson` ist die Person aus einem früheren
 * Schritt (nach 409 bei `person_waehlen`); sie geht immer mit, damit der
 * Server dieselbe Person nimmt.
 */
export function zuordnenKoerper(lage: AnrufDialogLage, e: ZuordnenEingabe, gewaehltePerson: string | null): ZuordnenKoerper {
  const mitPerson = (k: AnrufLeadKoerper): ZuordnenKoerper => ({
    ok: true,
    koerper: gewaehltePerson ? { ...k, personId: gewaehltePerson } : k,
  });
  switch (lage.art) {
    case "person_waehlen": {
      const id = e.personId;
      if (!id || !lage.treffer.some((t) => t.id === id)) return { ok: false, text: ZUORDNEN_TEXT.person };
      return { ok: true, koerper: { personId: id } };
    }
    case "lead_waehlen": {
      if (e.lead === "neu") return mitPerson({ neuerLead: true });
      const id = e.lead;
      if (!id || !lage.leads.some((l) => l.id === id)) return { ok: false, text: ZUORDNEN_TEXT.lead };
      return mitPerson({ dealId: id });
    }
    case "an_lead":
      return mitPerson({});
    case "neuer_lead": {
      if (lage.person || gewaehltePerson) return mitPerson({});
      const name = leadNameAusDialog(e.name);
      if (!name.ok) return { ok: false, text: ZUORDNEN_TEXT.name };
      return { ok: true, koerper: { name: name.name } };
    }
    default:
      return { ok: false, text: ZUORDNEN_TEXT.keiner };
  }
}

function alsKarten(wert: unknown): Karte[] {
  if (!Array.isArray(wert)) return [];
  return wert.filter(
    (k): k is Karte => !!k && typeof k === "object" && typeof (k as Karte).id === "string" && typeof (k as Karte).name === "string"
  );
}

/**
 * Neue Lage aus einer 409-Antwort (`karten`, `leads`): mehrere Leads → Lead
 * wählen (für die bekannte Person), mehrere Kunden → Kunde wählen; sonst null
 * (dann bleibt nur die Meldung).
 */
export function lageNachKonflikt(antwort: unknown, person: Karte | null): AnrufDialogLage | null {
  const a = (antwort && typeof antwort === "object" ? antwort : {}) as Record<string, unknown>;
  const leads = alsKarten(a.leads);
  if (leads.length >= 2) return { art: "lead_waehlen", person: person ?? { id: "", name: "Kunde" }, leads };
  const karten = alsKarten(a.karten);
  if (karten.length >= 2) return { art: "person_waehlen", treffer: karten };
  return null;
}

export type ZuordnenErgebnis =
  | { art: "fertig"; dealRecordId: string; bereitsDa: boolean }
  | { art: "konflikt"; text: string; lage: AnrufDialogLage | null }
  | { art: "fehler"; text: string };

/** Antwort der Route auswerten (Status und JSON-Körper). */
export function zuordnenErgebnis(status: number, body: unknown, person: Karte | null): ZuordnenErgebnis {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fehler = (b.error && typeof b.error === "object" ? b.error : {}) as Record<string, unknown>;
  const meldung = typeof fehler.message === "string" && fehler.message.trim() ? fehler.message : null;
  if (status >= 200 && status < 300) {
    const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
    if (typeof d.dealRecordId === "string" && d.dealRecordId) {
      return { art: "fertig", dealRecordId: d.dealRecordId, bereitsDa: d.bereitsDa === true };
    }
    return { art: "fehler", text: "Die Antwort des Servers war unvollständig." };
  }
  if (status === 409) {
    return { art: "konflikt", text: meldung ?? "Der Anruf lässt sich so nicht zuordnen.", lage: lageNachKonflikt(b, person) };
  }
  if (status === 404) return { art: "fehler", text: "Diesen Anruf gibt es nicht mehr." };
  if (status === 403) return { art: "fehler", text: meldung ?? "Keine Berechtigung zum Zuordnen." };
  if (status === 0) return { art: "fehler", text: "Keine Verbindung zum Server." };
  return { art: "fehler", text: meldung ?? `Der Server hat mit Fehler ${status} geantwortet.` };
}

/** Überschrift und Erklärung je Lage. */
export function zuordnenTitel(lage: AnrufDialogLage): { titel: string; text: string } {
  switch (lage.art) {
    case "person_waehlen":
      return {
        titel: "Welcher Kunde hat angerufen?",
        text: "Zu dieser Nummer gibt es mehrere Kunden. Hat der gewählte Kunde genau einen offenen Lead, kommt der Anruf dorthin. Bei mehreren fragt das CRM nach, ohne offenen Lead entsteht ein neuer.",
      };
    case "lead_waehlen":
      return { titel: "Zu welchem Lead gehört der Anruf?", text: `${lage.person.name} hat mehrere offene Leads.` };
    case "an_lead":
      return { titel: "An den offenen Lead hängen", text: `${lage.person.name} hat einen offenen Lead: ${lage.lead.name}.` };
    case "neuer_lead":
      return lage.person
        ? { titel: "Neuen Lead anlegen", text: `${lage.person.name} hat noch keinen offenen Lead. Der Anruf bekommt einen neuen.` }
        : { titel: "Neuen Lead anlegen", text: "Die Nummer gehört noch keinem Kunden. Es entstehen ein Kunde und ein Lead." };
    default:
      return { titel: "Zuordnen", text: ZUORDNEN_TEXT.keiner };
  }
}
