/**
 * Testdaten für Plan und Heute (Plan 8): Kalender-Ereignis, Leads-Eintrag und
 * Inbox-Eintrag mit sinnvollen Vorgaben, je Test überschreibbar. Heute ist
 * Freitag, 06.11.2026. Nur für Tests und Vorschauen, keine Server-Importe.
 */
import type { InboxEintrag, InboxListe } from "./inbox-neu";
import type { LeadKarte } from "./leads-board";
import type { LeadEintrag } from "./leads-board-bauen";
import type { CalendarEvent } from "@/services/calendar/map-events";

/** Fr 06.11.2026, 12:00 in Berlin */
export const PLAN_JETZT = new Date("2026-11-06T11:00:00.000Z");
export const PLAN_HEUTE = "2026-11-06";

export function kalenderEreignis(teil: Partial<CalendarEvent> = {}): CalendarEvent {
  const dealId = teil.dealId ?? "d1";
  return {
    id: `move:${dealId}`,
    uid: `move-${dealId}@umzug-suite`,
    dealId,
    kind: "move",
    title: "Familie Weber",
    appointmentLabel: null,
    date: "2026-11-10",
    endDate: "2026-11-10",
    allDay: false,
    startTime: "07:30",
    endTime: "13:00",
    fromAddress: "Rotebühlstr. 112, 70178 Stuttgart",
    toAddress: "Plochinger Str. 8, 73730 Esslingen",
    fromShort: "70178 Stuttgart",
    toShort: "73730 Esslingen",
    stageId: "s_geplant",
    stageTitle: "Geplant",
    stageColor: "#008760",
    stageExcluded: false,
    companyId: "f_kottke",
    companyName: "Kottke Umzüge",
    companyColor: "#1f3a5f",
    estimated: false,
    updatedAt: "2026-11-01T10:00:00.000Z",
    href: `/objects/deals/${dealId}`,
    dateSource: "attribute",
    endIsFallback: false,
    ...teil,
  };
}

export function leadKarte(teil: Partial<LeadKarte> = {}): LeadKarte {
  return {
    id: "d1",
    nummer: "2026-041",
    name: "Familie Weber",
    stufe: { id: "s_geplant", label: "Geplant", kategorie: "booked" },
    spalteId: "s_geplant",
    betrag: { cent: 295000, art: "fest" },
    betragText: "2.950 €",
    art: "Umzug",
    von: "Stuttgart-Süd",
    nach: "Esslingen",
    termin: "2026-11-10",
    was: "Umzug · Stuttgart-Süd → Esslingen · 10.11.",
    wartet: { auf: "niemand", seit: null, text: null, ton: null },
    quelle: null,
    firma: { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" },
    team: [
      { kuerzel: "MK", name: "Max Kottke" },
      { kuerzel: "AB", name: "Ali Bulut" },
    ],
    teamFehlt: false,
    kontext: null,
    aktivitaet: "2026-11-05T10:00:00.000Z",
    aktivitaetText: "gestern",
    zahlungGemeldet: null,
    fakten: { annahmeAm: null, kvVorhanden: true, verlustGrund: null },
    kvLink: "/app/leads/d1/kalkulation",
    erstelltAm: "2026-10-20T10:00:00.000Z",
    ...teil,
  };
}

export function leadEintrag(teil: Partial<LeadKarte> = {}, chips: LeadEintrag["chips"] = []): LeadEintrag {
  const karte = leadKarte(teil);
  return { karte, chips, suchtext: karte.name.toLocaleLowerCase("de-DE"), telefonZiffern: [] };
}

export function inboxEintrag(teil: Partial<InboxEintrag> = {}): InboxEintrag {
  return {
    key: "deal:d1",
    dealId: "d1",
    gespraechIds: ["c1"],
    name: "Familie Weber",
    kuerzel: "FW",
    kanal: "whatsapp",
    kanaele: ["whatsapp"],
    kleinanzeigen: false,
    vorschau: "Hallo",
    vorschauPraefix: null,
    zeit: "2026-11-06T09:00:00.000Z",
    zeitText: "10:00",
    ungelesen: 0,
    wartet: { auf: "niemand", seit: null, text: null },
    kiEntwurf: null,
    stufe: null,
    gruppe: "haupt",
    laneText: null,
    firma: null,
    ...teil,
  };
}

export function inboxListe(eintraege: InboxEintrag[], teil: Partial<InboxListe> = {}): InboxListe {
  return {
    eintraege,
    chips: {
      ungelesen: eintraege.filter((e) => e.gruppe === "haupt" && e.ungelesen > 0).length,
      wartenAufUns: eintraege.filter((e) => e.wartet.auf === "uns").length,
      kiEntwuerfe: eintraege.filter((e) => e.kiEntwurf !== null).length,
      infoKeinLead: eintraege.filter((e) => e.gruppe === "info").length,
    },
    firmen: [],
    stufen: [],
    abgeschnitten: false,
    ...teil,
  };
}
