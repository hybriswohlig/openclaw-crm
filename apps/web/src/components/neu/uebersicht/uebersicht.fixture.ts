/**
 * Beispieldaten der Übersicht (Plan 13) für Entwicklung und Tests: leer,
 * zwölf Monate mit einer negativen Monatssumme nach Storno.
 */
import { monateBis, type UebersichtAntwort } from "@/lib/einstellungen-uebersicht";

const MONATE = monateBis("2026-11-09");
const leer = <T,>(f: () => T) => Object.fromEntries(MONATE.map((m) => [m, f()])) as Record<string, T>;

export const FIXTURE_LEER: UebersichtAntwort = {
  monate: MONATE,
  firma: null,
  firmen: [],
  eingegangen: leer(() => 0),
  durchgefuehrt: leer(() => ({ cent: 0, anzahl: 0, ohneBetrag: 0 })),
  anfragen: { quellen: [], je: leer(() => ({})), gesamt: leer(() => 0) },
  abschluss: { je: leer(() => ({ gewonnen: 0, verloren: 0, offen: 0, quoteProzent: null })), gesamt: { gewonnen: 0, verloren: 0, offen: 0, quoteProzent: null } },
  offen: { rest: { anzahl: 0, cent: 0, unbekannt: 0 }, ohneRechnung: { anzahl: 0, cent: 0, unbekannt: 0 } },
  wartetAufUns: 0,
  stand: "2026-11-09T09:30:00.000Z",
};

export const FIXTURE_ZWOELF: UebersichtAntwort = {
  ...FIXTURE_LEER,
  firmen: [
    { id: "oc-k", name: "Kottke Umzüge" },
    { id: "oc-c", name: "Ceylan Transporte" },
  ],
  eingegangen: Object.fromEntries(MONATE.map((m, i) => [m, i === 3 ? -42000 : 900000 + i * 85000])),
  durchgefuehrt: Object.fromEntries(MONATE.map((m, i) => [m, { cent: 800000 + i * 90000, anzahl: 6 + (i % 4), ohneBetrag: i % 3 === 0 ? 1 : 0 }])),
  anfragen: {
    quellen: [
      { id: "web", label: "Website" },
      { id: "wa", label: "WhatsApp" },
      { id: "tel", label: "Telefon" },
      { id: "my", label: "MyHammer" },
      { id: "emp", label: "Empfehlung" },
      { id: "is", label: "ImmoScout" },
      { id: "ohne", label: "Ohne Quelle" },
    ],
    je: Object.fromEntries(MONATE.map((m, i) => [m, { web: 10 + i, wa: 6, tel: 4 + (i % 3), my: 3, emp: 2, is: 1, ohne: 2 }])),
    gesamt: Object.fromEntries(MONATE.map((m, i) => [m, 28 + i + (i % 3)])),
  },
  abschluss: {
    je: Object.fromEntries(
      MONATE.map((m, i) => {
        const g = i > 9 ? 2 : 8;
        const v = i > 9 ? 1 : 6;
        const o = i > 9 ? 14 : 1;
        return [m, { gewonnen: g, verloren: v, offen: o, quoteProzent: Math.round((g / (g + v)) * 100) }];
      }),
    ),
    gesamt: { gewonnen: 84, verloren: 62, offen: 38, quoteProzent: 58 },
  },
  offen: { rest: { anzahl: 7, cent: 1234500, unbekannt: 2 }, ohneRechnung: { anzahl: 3, cent: 450000, unbekannt: 1 } },
  wartetAufUns: 5,
};
