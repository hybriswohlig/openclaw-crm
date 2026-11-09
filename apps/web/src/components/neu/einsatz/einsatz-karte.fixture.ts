/**
 * Erfundene Daten für Tests und Sichtprüfung der Karten-Ansicht (Plan 12c):
 * Umzug Stuttgart-West → Esslingen, sieben Personen, drei davon am selben Ort
 * (Bündel), eine belegt, eine im Urlaub, eine ohne Wohnort, ein Ort ohne
 * Kartenpunkt. Keine echten Personen.
 */
import type { EinsatzKarte, KartenPerson } from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage } from "@/lib/einsatz-ansicht";

const person = (id: string, name: string, o: Partial<EinsatzPersonLage> = {}): EinsatzPersonLage => ({
  id,
  name,
  kuerzel: name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase(),
  aktiv: true,
  plz: "70372",
  wohnort: "Stuttgart",
  kannSprinter: false,
  eigenerPkw: true,
  satzFahrtCent: 1500,
  satzArbeitCent: 2000,
  lage: "frei",
  belegtMit: [],
  abwesend: null,
  stempeltGerade: false,
  ...o,
});

export const FIXTURE_PERSONEN: EinsatzPersonLage[] = [
  person("ma_mk", "Marco Keller", { kannSprinter: true, satzArbeitCent: 2300 }),
  person("ma_ak", "Anna Keller", { eigenerPkw: false }),
  person("ma_dr", "Deniz Roth", {}),
  person("ma_ts", "Tobias Schmid", { plz: "71634", wohnort: "Ludwigsburg", satzFahrtCent: 1600 }),
  person("ma_jb", "Jonas Brandt", {
    plz: "71032",
    wohnort: "Böblingen",
    kannSprinter: true,
    lage: "belegt",
    belegtMit: [{ dealId: "deal_nowak", titel: "Umzug Nowak" }],
  }),
  person("ma_lf", "Lena Fischer", { plz: "72072", wohnort: "Tübingen", lage: "abwesend", abwesend: "urlaub" }),
  person("ma_po", "Paul Ohneort", { plz: null, wohnort: null, eigenerPkw: false }),
  person("ma_xy", "Xenia Yilmaz", { plz: "75172", wohnort: "Pforzheim" }),
];

const ps = { arbeitPm: 900, fahrerPm: 60, fahrzeitPm: 180, pufferProzent: 10 };

export const FIXTURE_ANSICHT: EinsatzAnsicht = {
  dealId: "deal_fixture",
  titel: "Umzug Muster",
  firmaId: null,
  tage: ["2026-11-20"],
  fest: true,
  version: { nummer: 2, status: "gesperrt" },
  beladen: "Rotebühlstraße 50, 70178 Stuttgart",
  entladen: "Ritterstraße 5, 73728 Esslingen",
  team: [],
  personen: FIXTURE_PERSONEN,
  kapazitaet: [
    {
      tag: "2026-11-20",
      frei: [],
      belegt: [],
      abwesend: [],
      freiZahl: 5,
      ton: "gruen",
      text: "5 frei",
    },
  ],
  teamVorschlag: {
    team: [
      { employeeId: "ma_mk", role: "lead", plannedDriveMinutes: null, plannedWorkMinutes: null },
      { employeeId: "ma_ak", role: "helper", plannedDriveMinutes: null, plannedWorkMinutes: null },
    ],
    fehlen: 1,
    hinweise: [],
  },
  rechner: {
    groesse: 3,
    auftragsart: "umzug",
    fahrtMin: 60,
    personenH: 20.24,
    personalStunden: ps,
    posten: [
      { key: "personal.arbeit", betrag: ((900 + 60) / 60) * 1.1 * 20 },
      { key: "personal.fahrt", betrag: ((60 * 3) / 60) * 1.1 * 15 },
    ],
    festpreisEur: 1290,
    selbstkostenEur: 813,
    fahrzeugName: "Sprinter L",
    fahrzeugEur: 120,
    station: "Sixt Feuerbach",
    empfehlung: { id: "o1", name: "Sprinter L", fahrten: 1, km: 64 },
  },
  anfahrten: [
    { employeeId: "ma_mk", anKm: 9, abKm: 14, anMin: 18, abMin: 17, anMinQuelle: "verkehr" },
    { employeeId: "ma_ak", anKm: 9, abKm: 14, anMin: 22, abMin: 17, anMinQuelle: "verkehr" },
    { employeeId: "ma_dr", anKm: 9, abKm: 14, anMin: 20, abMin: 17, anMinQuelle: "verkehr" },
    { employeeId: "ma_ts", anKm: 17, abKm: 30, anMin: 31, abMin: 36, anMinQuelle: "verkehr" },
    { employeeId: "ma_jb", anKm: 21, abKm: 33, anMin: 26, abMin: 40, anMinQuelle: "geschaetzt" },
    { employeeId: "ma_xy", anKm: 48, abKm: 60, anMin: 44, abMin: 72, anMinQuelle: "geschaetzt" },
  ],
  einsatzKosten: [],
  lohnVergleich: {
    lohnCent: 0,
    anfahrtCent: 0,
    summeCent: 0,
    kalkulationCent: null,
    differenzCent: null,
    margeKalkulationProzent: null,
    margeNeuProzent: null,
    text: null,
    ton: "normal",
  },
  auslastung: { anteil: 0.82, text: "82 %", formel: "Ladevolumen ÷ (Laderaum × Fahrten)", ton: "normal" },
  anfahrtUebernommenEur: null,
  buchung: null,
  buchungenAmTag: [],
  buchungImPreis: false,
  stationVorgabe: null,
  klasseVorgabe: null,
  hinweise: [],
};

const k = (p: EinsatzPersonLage, punkt: [number, number] | null, schluessel: string | null): KartenPerson => ({
  employeeId: p.id,
  name: p.name,
  kuerzel: p.kuerzel,
  ortText: p.plz && p.wohnort ? `${p.plz} ${p.wohnort}` : p.wohnort,
  ortSchluessel: schluessel,
  punkt,
  lage: p.lage,
});

const [mk, ak, dr, ts, jb, lf, po, xy] = FIXTURE_PERSONEN as [
  EinsatzPersonLage,
  EinsatzPersonLage,
  EinsatzPersonLage,
  EinsatzPersonLage,
  EinsatzPersonLage,
  EinsatzPersonLage,
  EinsatzPersonLage,
  EinsatzPersonLage,
];

/** Hauptstrecke Stuttgart-West → Esslingen, grob über die B 10. */
export const FIXTURE_LINIE: [number, number][] = [
  [9.1655, 48.7731],
  [9.1802, 48.7784],
  [9.1951, 48.7849],
  [9.2165, 48.7894],
  [9.2412, 48.7735],
  [9.2702, 48.7552],
  [9.3045, 48.7409],
];

export const FIXTURE_KARTE: EinsatzKarte = {
  beladen: { punkt: FIXTURE_LINIE[0]!, text: "Stuttgart", quelle: "route" },
  entladen: { punkt: FIXTURE_LINIE[FIXTURE_LINIE.length - 1]!, text: "Esslingen", quelle: "route" },
  linie: FIXTURE_LINIE,
  hinweise: ["1 Ort ohne Kartenpunkt."],
  personen: [
    k(mk, [9.2205, 48.8045], "70372 stuttgart"),
    k(ak, [9.2205, 48.8045], "70372 stuttgart"),
    k(dr, [9.2205, 48.8045], "70372 stuttgart"),
    k(ts, [9.1917, 48.8973], "71634 ludwigsburg"),
    k(jb, [9.0089, 48.6857], "71032 böblingen"),
    k(lf, [9.0576, 48.5216], "72072 tübingen"),
    k(po, null, null),
    k(xy, null, "75172 pforzheim"),
  ],
};

/** Ohne Route: Beladen als Ortsmitte aus dem Chat, kein Entladen. */
export const FIXTURE_KARTE_OHNE_ROUTE: EinsatzKarte = {
  ...FIXTURE_KARTE,
  beladen: { punkt: [9.1829, 48.7758], text: "Stuttgart", quelle: "chat" },
  entladen: null,
  linie: [],
  hinweise: [],
};
