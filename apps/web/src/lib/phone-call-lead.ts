import { stufenKategorie } from "@/services/lagekarte/status";

/**
 * Reine Entscheidungen für „Lead aus Anruf“. Kein Datenbankzugriff.
 * Dieselbe Offen-Regel wie isOpenStage: null gilt als offen, die Kategorien
 * open_new, open_engaged, quoted und booked sind offen.
 */

export type AnrufStatus = "matched" | "unmatched" | "ambiguous" | "no_number";

const STATUS: readonly AnrufStatus[] = ["matched", "unmatched", "ambiguous", "no_number"];

export interface PersonenKarte {
  id: string;
  name: string;
}

export type LeadWahl = { art: "bestehend"; dealId: string } | { art: "neu" };

export interface AnrufLeadLage {
  matchStatus: AnrufStatus;
  dealRecordId: string | null;
  callerE164: string | null;
  /** Person steht schon auf dem Anruf und der Datensatz lebt noch. */
  angehaengtePersonId: string | null;
  /** Lebende Personen, denen die Nummer jetzt gehört. Bei no_number unbenutzt. */
  personen: PersonenKarte[];
  /** Offene Leads der Person, an die der Anruf käme. Bei einer neuen Person leer. */
  offeneLeads: PersonenKarte[];
  wahl: LeadWahl | null;
  name: string | null;
}

export type AnrufLeadEntscheid =
  | { art: "fertig"; dealRecordId: string }
  | {
      art: "abbruch";
      grund: "matched" | "ambiguous" | "mehrere_personen" | "mehrere_leads";
      karten: PersonenKarte[];
      leads: PersonenKarte[];
    }
  | { art: "name" }
  | {
      art: "anlegen";
      person: { neu: true; name: string } | { neu: false; id: string };
      lead: { neu: true } | { neu: false; id: string };
      status: AnrufStatus;
      /** Kanonische Anrufernummer, nur wenn eine neue Person sie bekommen soll. */
      telefon: string | null;
    };

const NAME_MIN = 2;
const NAME_MAX = 120;

export function istAnrufStatus(value: string): value is AnrufStatus {
  return (STATUS as readonly string[]).includes(value);
}

/** Knopf nur bei ungeklärtem Anruf ohne Lead. Mehrere Kunden blendet die Liste aus. */
export function zeigeLeadKnopf(matchStatus: string, dealRecordId: string | null): boolean {
  if (dealRecordId) return false;
  return matchStatus === "unmatched" || matchStatus === "no_number";
}

export function statusNachLead(status: AnrufStatus): AnrufStatus {
  if (status === "unmatched") return "matched";
  return status;
}

export function sperrSchluessel(workspaceId: string, callerE164: string | null, callId: string): string {
  if (callerE164) return `nummer:${workspaceId}:${callerE164}`;
  return `anruf:${callId}`;
}

export function anrufSperre(callId: string): string {
  return `anruf:${callId}`;
}

/** true, wenn die Stufe noch kein abgeschlossener Auftrag ist. null zählt als offen. */
export function istOffeneStufe(stufe: { title: string; stageCategory?: string | null } | null): boolean {
  if (!stufe) return true;
  const category = stufenKategorie({ titel: stufe.title, kategorie: stufe.stageCategory ?? null });
  if (!category) return !/verloren|lost|bezahlt|paid|durchgef|gewonnen|won|\bdone\b/i.test(stufe.title);
  return category === "open_new" || category === "open_engaged" || category === "quoted" || category === "booked";
}

export function leadNameAusDialog(raw: string | null | undefined): { ok: true; name: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false };
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false };
  const ohneTrenner = name.replace(/[\s+\-./()]/g, "");
  if (/^\d+$/.test(ohneTrenner)) return { ok: false };
  return { ok: true, name };
}

/** Nur eine eigene Zeile Name:, Anrufer: oder Kunde:. Fließtext ergibt nichts. */
export function nameAusZusammenfassung(summary: string | null | undefined): string | null {
  if (!summary) return null;
  for (const zeile of summary.split(/\r?\n/)) {
    const treffer = /^(?:name|anrufer|kunde)\s*:\s*(.+)$/i.exec(zeile.trim());
    if (!treffer) continue;
    const name = leadNameAusDialog(treffer[1]);
    if (name.ok) return name.name;
  }
  return null;
}

export function personNameWert(name: string): { firstName: string; lastName: string; fullName: string } {
  const fullName = name.trim().replace(/\s+/g, " ");
  const parts = fullName.split(" ");
  if (parts.length <= 1) return { firstName: fullName, lastName: "", fullName };
  return { firstName: parts[0], lastName: parts.slice(1).join(" "), fullName };
}

/** Beide Schreibweisen, damit die Karte den Namen in der Liste und in der Akte zeigt. */
export function personNameJson(name: string): Record<string, string> {
  const wert = personNameWert(name);
  return {
    firstName: wert.firstName,
    lastName: wert.lastName,
    fullName: wert.fullName,
    first_name: wert.firstName,
    last_name: wert.lastName,
    full_name: wert.fullName,
  };
}

/** Wessen offene Leads vor der Entscheidung geladen werden müssen. */
export function leadsPersonenId(
  lage: Pick<AnrufLeadLage, "matchStatus" | "dealRecordId" | "callerE164" | "personen" | "angehaengtePersonId">
): string | null {
  if (lage.dealRecordId) return null;
  if (lage.matchStatus === "matched" || lage.matchStatus === "ambiguous") return null;
  const ohneNummer = lage.matchStatus === "no_number" || !lage.callerE164;
  if (ohneNummer) return lage.angehaengtePersonId;
  if (lage.personen.length === 1) return lage.personen[0].id;
  if (lage.personen.length === 0) return lage.angehaengtePersonId;
  return null;
}

export function entscheideAnrufLead(lage: AnrufLeadLage): AnrufLeadEntscheid {
  if (lage.dealRecordId) return { art: "fertig", dealRecordId: lage.dealRecordId };
  if (lage.matchStatus === "matched") {
    return { art: "abbruch", grund: "matched", karten: [], leads: [] };
  }
  if (lage.matchStatus === "ambiguous") {
    return { art: "abbruch", grund: "ambiguous", karten: lage.personen, leads: [] };
  }

  const ohneNummer = lage.matchStatus === "no_number" || !lage.callerE164;
  let person: { neu: true } | { neu: false; id: string };
  if (ohneNummer) {
    person = lage.angehaengtePersonId ? { neu: false, id: lage.angehaengtePersonId } : { neu: true };
  } else if (lage.personen.length >= 2) {
    return { art: "abbruch", grund: "mehrere_personen", karten: lage.personen, leads: [] };
  } else if (lage.personen.length === 1) {
    person = { neu: false, id: lage.personen[0].id };
  } else if (lage.angehaengtePersonId) {
    person = { neu: false, id: lage.angehaengtePersonId };
  } else {
    person = { neu: true };
  }

  let festgelegt: { neu: true; name: string } | { neu: false; id: string };
  if (person.neu) {
    const name = leadNameAusDialog(lage.name);
    if (!name.ok) return { art: "name" };
    festgelegt = { neu: true, name: name.name };
  } else {
    festgelegt = person;
  }

  const leads = festgelegt.neu ? [] : lage.offeneLeads;
  let lead: { neu: true } | { neu: false; id: string };
  if (leads.length === 0) {
    lead = { neu: true };
  } else if (leads.length === 1) {
    lead = { neu: false, id: leads[0].id };
  } else {
    const wahl = lage.wahl;
    if (!wahl) {
      return { art: "abbruch", grund: "mehrere_leads", karten: [], leads };
    }
    if (wahl.art === "neu") {
      lead = { neu: true };
    } else if (leads.some((eintrag) => eintrag.id === wahl.dealId)) {
      lead = { neu: false, id: wahl.dealId };
    } else {
      return { art: "abbruch", grund: "mehrere_leads", karten: [], leads };
    }
  }

  const status = statusNachLead(lage.matchStatus);
  return {
    art: "anlegen",
    person: festgelegt,
    lead,
    status,
    telefon: festgelegt.neu && !ohneNummer ? lage.callerE164 : null,
  };
}
