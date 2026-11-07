import { describe, expect, it } from "vitest";
import {
  chipsZaehlen,
  eintragAus,
  filtern,
  kontextAus,
  laeuftGrund,
  listeSortieren,
  passtSuche,
  seite,
  sortierenInSpalte,
  spaltenBauen,
  spalteFuer,
  stufeZeileAus,
  teamFehltAus,
  type LeadEintrag,
  type LeadRoh,
  type StufeZeile,
} from "./leads-board-bauen";
import { BOARD_SEITE, LEERER_FILTER, OHNE_STUFE, type LeadFirma, type LeadQuelle, type LeadsFilter } from "./leads-board";

/** Freitag, 06.11.2026, 12:00 in Berlin. Woche Mo 02.11. bis So 08.11. */
const JETZT = new Date("2026-11-06T11:00:00.000Z");
const vor = (min: number, ab: Date = JETZT) => new Date(ab.getTime() - min * 60_000).toISOString();
const TAG = 24 * 60;

const STUFEN: StufeZeile[] = [
  { id: "s_neu", label: "Neue Anfrage", kategorie: "open_new", reihenfolge: 0, aktiv: true },
  { id: "s_kontakt", label: "In Kontakt", kategorie: "open_engaged", reihenfolge: 1, aktiv: true },
  { id: "s_angebot", label: "Angebot", kategorie: "quoted", reihenfolge: 2, aktiv: true },
  { id: "s_alt", label: "Quoted", kategorie: "quoted", reihenfolge: 2, aktiv: false },
  { id: "s_geplant", label: "Geplant", kategorie: "booked", reihenfolge: 3, aktiv: true },
  { id: "s_durch", label: "Durchgeführt", kategorie: "done_unpaid", reihenfolge: 4, aktiv: true },
  { id: "s_bezahlt", label: "Bezahlt", kategorie: "paid", reihenfolge: 5, aktiv: true },
  { id: "s_verloren", label: "Verloren", kategorie: "lost", reihenfolge: 6, aktiv: true },
  { id: "s_kein", label: "Kein Lead", kategorie: "kein_lead", reihenfolge: 7, aktiv: true },
  { id: "s_sonst", label: "Irgendwas", kategorie: null, reihenfolge: 8, aktiv: true },
];

const FIRMEN = new Map<string, LeadFirma>([
  ["f_kottke", { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" }],
  ["f_ceylan", { id: "f_ceylan", name: "Ceylan", farbe: "#c9361a" }],
]);
const QUELLEN = new Map<string, LeadQuelle>([
  ["q_wa", { id: "q_wa", label: "WhatsApp" }],
  ["q_ka", { id: "q_ka", label: "Kleinanzeigen" }],
]);
const K = { stufen: STUFEN, firmen: FIRMEN, quellen: QUELLEN };

function roh(teil: Partial<LeadRoh> = {}): LeadRoh {
  return {
    id: "d1",
    erstelltAm: vor(10 * TAG),
    nummer: null,
    name: "Familie Weber",
    stufeId: "s_neu",
    umzugAm: null,
    terminAuswahl: null,
    von: null,
    nach: null,
    firmaId: null,
    quelleId: null,
    wert: null,
    besichtigungAm: null,
    verlustGrund: null,
    wartet: null,
    angebot: null,
    optionen: [],
    annahme: null,
    portalZuletztGeoeffnet: null,
    versionen: { gesperrt: null, entwurf: null },
    rechner: null,
    dokumente: { kvErstesAm: null, rechnungAm: null },
    zahlungen: [],
    team: [],
    fotos: 0,
    telefone: [],
    meldungsEreignisse: [],
    letzteNachrichtAm: null,
    ...teil,
  };
}

const angebot = (teil: Partial<NonNullable<LeadRoh["angebot"]>> = {}): NonNullable<LeadRoh["angebot"]> => ({
  festpreisEuro: null,
  istStunden: false,
  serviceType: "move",
  mitEntruempelung: false,
  gueltigBis: null,
  selectedPackageOptionId: null,
  ohneVersion: true,
  versionGesendetAm: null,
  positionen: [],
  ...teil,
});

const eintrag = (teil: Partial<LeadRoh> = {}, jetzt = JETZT) => eintragAus(roh(teil), K, jetzt);
const filter = (teil: Partial<LeadsFilter> = {}): LeadsFilter => ({ ...LEERER_FILTER, ...teil });
const namen = (es: LeadEintrag[]) => es.map((e) => e.karte.id);

describe("stufeZeileAus", () => {
  it("Kategorie aus stage_category, sonst aus dem Titel; is_active auch als Text", () => {
    expect(stufeZeileAus({ id: "a", title: "Quoted (merged)", stage_category: null, sort_order: "2", is_active: "f" })).toEqual({
      id: "a",
      label: "Quoted (merged)",
      kategorie: "quoted",
      reihenfolge: 2,
      aktiv: false,
    });
    expect(stufeZeileAus({ id: "b", title: "X", stage_category: "kein_lead", sort_order: 7, is_active: true }).kategorie).toBe("kein_lead");
  });
});

describe("spalteFuer (Entscheidung 2)", () => {
  it("aktive Stufe einer Board-Kategorie: eigene Spalte", () => {
    expect(spalteFuer("s_angebot", STUFEN)).toBe("s_angebot");
    expect(spalteFuer("s_verloren", STUFEN)).toBe("s_verloren");
  });
  it("inaktive Stufe: aktive Stufe derselben Kategorie", () => {
    expect(spalteFuer("s_alt", STUFEN)).toBe("s_angebot");
  });
  it("ohne Stufe, unbekannte ID, Stufe ohne Kategorie oder Kategorie ohne aktive Stufe: Ohne Stufe", () => {
    expect(spalteFuer(null, STUFEN)).toBe(OHNE_STUFE);
    expect(spalteFuer("weg", STUFEN)).toBe(OHNE_STUFE);
    expect(spalteFuer("s_sonst", STUFEN)).toBe(OHNE_STUFE);
    const ohneBezahlt = STUFEN.map((s) => (s.id === "s_bezahlt" ? { ...s, aktiv: false } : s));
    expect(spalteFuer("s_bezahlt", ohneBezahlt)).toBe(OHNE_STUFE);
  });
  it("bei aktiver englischer Dublette gewinnt die deutsche Stufe", () => {
    const mitDublette: StufeZeile[] = [
      { id: "s_en", label: "Quoted", kategorie: "quoted", reihenfolge: 1, aktiv: true },
      { id: "s_de", label: "Angebot", kategorie: "quoted", reihenfolge: 2, aktiv: true },
      { id: "s_inaktiv", label: "Angebot alt", kategorie: "quoted", reihenfolge: 0, aktiv: false },
    ];
    expect(spalteFuer("s_inaktiv", mitDublette)).toBe("s_de");
  });
});

describe("Karte", () => {
  it("Name, Firma, Quelle, Orte, Was-Zeile, Nummer, Stufe der inaktiven Stufe", () => {
    const e = eintrag({
      id: "d7",
      name: "  ",
      stufeId: "s_alt",
      nummer: "2026-042",
      firmaId: "f_ceylan",
      quelleId: "q_ka",
      von: { line1: "Hauptstr. 1", postcode: "70178", city: "Stuttgart-Ost" },
      nach: "Bahnhofstr. 2, 70734 Fellbach",
      umzugAm: "2026-11-28",
      angebot: angebot({ serviceType: "move", mitEntruempelung: true }),
    });
    expect(e.karte).toMatchObject({
      id: "d7",
      name: "Ohne Namen",
      nummer: "2026-042",
      stufe: { id: "s_alt", label: "Quoted", kategorie: "quoted" },
      spalteId: "s_angebot",
      art: "Entrümpelung und Umzug",
      von: "Stuttgart-Ost",
      nach: "Fellbach",
      termin: "2026-11-28",
      was: "Entrümpelung und Umzug · Stuttgart-Ost → Fellbach · 28.11.",
      firma: { id: "f_ceylan", name: "Ceylan", farbe: "#c9361a" },
      quelle: { id: "q_ka", label: "Kleinanzeigen" },
      kvLink: "/app/leads/d7/kalkulation",
      erstelltAm: vor(10 * TAG),
    });
  });

  it("unbekannte Firma und Quelle: null; ohne Stufe: „Ohne Stufe“; Termin aus der Datumswahl", () => {
    const e = eintrag({ stufeId: null, firmaId: "f_weg", quelleId: "q_weg", terminAuswahl: "2026-12-01" });
    expect(e.karte.firma).toBeNull();
    expect(e.karte.quelle).toBeNull();
    expect(e.karte.stufe).toEqual({ id: null, label: "Ohne Stufe", kategorie: null });
    expect(e.karte.spalteId).toBe(OHNE_STUFE);
    expect(e.karte.termin).toBe("2026-12-01");
    expect(e.karte.wartet).toMatchObject({ text: "läuft", ton: "jade" });
  });

  it("Warte-Pille live aus waiting_since; Endstufe ohne Pille trotz veraltetem „uns“", () => {
    expect(eintrag({ wartet: { auf: "uns", seit: vor(35), grund: "Kunde wartet auf Antwort" } }).karte.wartet).toEqual({
      auf: "uns",
      seit: vor(35),
      text: "Wartet auf uns · 35 Min",
      ton: "gold",
    });
    expect(
      eintrag({ stufeId: "s_angebot", wartet: { auf: "uns", seit: vor(4 * TAG), grund: "KV seit 3 Tagen ungesehen" } }).karte.wartet.text,
    ).toBe("KV ungesehen · 4 Tage");
    expect(eintrag({ stufeId: "s_verloren", wartet: { auf: "uns", seit: vor(5), grund: null } }).karte.wartet).toEqual({
      auf: "niemand",
      seit: null,
      text: null,
      ton: null,
    });
  });

  it("Aktivität: letzte Nachricht, sonst Anlage", () => {
    expect(eintrag({ letzteNachrichtAm: vor(35) }).karte).toMatchObject({ aktivitaet: vor(35), aktivitaetText: "vor 35 Min" });
    expect(eintrag().karte).toMatchObject({ aktivitaet: vor(10 * TAG), aktivitaetText: "vor 10 Tagen" });
  });

  it("Team mit Kürzeln in Zuteilungsreihenfolge", () => {
    expect(eintrag({ stufeId: "s_geplant", team: ["Max Kottke", "Ali"] }).karte.team).toEqual([
      { kuerzel: "MK", name: "Max Kottke" },
      { kuerzel: "A", name: "Ali" },
    ]);
  });

  it("Zahlungsmeldung: offene Meldung als Zeile, erledigte nicht", () => {
    const gemeldet = { id: "ev1", eventType: "customer.marked_paid", payload: { amountCents: 50000, variant: "final" }, createdAt: vor(60) };
    expect(eintrag({ stufeId: "s_durch", meldungsEreignisse: [gemeldet] }).karte.zahlungGemeldet).toBe("Kunde meldet bezahlt · 500 €");
    const bestaetigt = { id: "ev2", eventType: "payment.meldung_bestaetigt", payload: { eventId: "ev1", variante: "final" }, createdAt: vor(30) };
    expect(eintrag({ stufeId: "s_durch", meldungsEreignisse: [gemeldet, bestaetigt] }).karte.zahlungGemeldet).toBeNull();
  });

  it("Fakten für den Zug: Annahme, KV vorhanden (Dokument oder gesendete Version), Verlustgrund", () => {
    expect(eintrag().karte.fakten).toEqual({ annahmeAm: null, kvVorhanden: false, verlustGrund: null });
    expect(
      eintrag({
        annahme: { cent: 190000, am: vor(3 * TAG) },
        verlustGrund: "g_preis",
        dokumente: { kvErstesAm: vor(5 * TAG), rechnungAm: null },
      }).karte.fakten,
    ).toEqual({ annahmeAm: vor(3 * TAG), kvVorhanden: true, verlustGrund: "g_preis" });
    expect(
      eintrag({
        angebot: angebot({ ohneVersion: false }),
        versionen: { gesperrt: { version: 2, cent: 100000, gesendetAm: vor(TAG), teamSoll: null }, entwurf: null },
      }).karte.fakten.kvVorhanden,
    ).toBe(true);
    expect(eintrag({ verlustGrund: " " }).karte.fakten.verlustGrund).toBeNull();
  });

  it("kvLink: bei Paketoptionen oder Stunden-KV der alte Angebots-Tab", () => {
    expect(eintrag({ id: "d9", angebot: angebot({ istStunden: true }) }).karte.kvLink).toBe("/objects/deals/d9?alt=1&tab=quotation");
    expect(
      eintrag({ id: "d9", optionen: [{ id: "o1", priceCents: 1000, isRecommended: true, sortOrder: 0 }] }).karte.kvLink,
    ).toBe("/objects/deals/d9?alt=1&tab=quotation");
  });
});

describe("Betrag (Entscheidung 11)", () => {
  it("fest: Annahme, dann Angebot", () => {
    expect(eintrag({ annahme: { cent: 190000, am: vor(1) }, angebot: angebot({ festpreisEuro: "2480" }) }).karte).toMatchObject({
      betrag: { cent: 190000, art: "fest" },
      betragText: "1.900 €",
    });
    expect(eintrag({ angebot: angebot({ festpreisEuro: "2480.00" }) }).karte.betragText).toBe("2.480 €");
    expect(
      eintrag({ angebot: angebot({ istStunden: true, positionen: [{ quantity: 3, unitRateEuro: "45.50" }, { quantity: 1, unitRateEuro: "120" }] }) })
        .karte.betrag,
    ).toEqual({ cent: 25650, art: "fest" });
  });

  it("geschätzt: Kalkulationsversion (gesperrt vor Entwurf), dann value, dann Rechner-Festpreis", () => {
    const versionen = {
      gesperrt: { version: 1, cent: 180000, gesendetAm: null, teamSoll: null },
      entwurf: { cent: 175000, teamSoll: null },
    };
    expect(eintrag({ versionen, wert: { amount: 999 } }).karte).toMatchObject({
      betrag: { cent: 180000, art: "geschaetzt" },
      betragText: "~1.800 €",
    });
    expect(eintrag({ versionen: { gesperrt: null, entwurf: { cent: 175000, teamSoll: null } } }).karte.betragText).toBe("~1.750 €");
    expect(eintrag({ wert: { amount: 1900, currencyCode: "EUR" } }).karte.betragText).toBe("~1.900 €");
    expect(eintrag({ wert: 800 }).karte.betragText).toBe("~800 €");
    expect(eintrag({ wert: "800" }).karte.betragText).toBe("~800 €");
    expect(eintrag({ rechner: { festpreis: "1234", teamSoll: null } }).karte.betragText).toBe("~1.234 €");
  });

  it("nichts: „ohne Preis“", () => {
    expect(eintrag().karte).toMatchObject({ betrag: null, betragText: "ohne Preis" });
    expect(eintrag({ wert: { amount: 0 }, versionen: { gesperrt: null, entwurf: { cent: 0, teamSoll: null } } }).karte.betrag).toBeNull();
  });
});

describe("teamFehltAus und Team-Soll (Entscheidung 12)", () => {
  it("mit Soll: Ist unter Soll; ohne Soll: nur ohne Team", () => {
    expect(teamFehltAus(3, 1)).toBe(true);
    expect(teamFehltAus(3, 3)).toBe(false);
    expect(teamFehltAus(2, 4)).toBe(false);
    expect(teamFehltAus(null, 0)).toBe(true);
    expect(teamFehltAus(null, 1)).toBe(false);
  });
  it("Soll aus gesperrter Version, sonst Entwurf, sonst deal_calculations", () => {
    const versionen = (g: number | null, e: number | null) => ({
      gesperrt: g === null ? null : { version: 1, cent: null, gesendetAm: null, teamSoll: g },
      entwurf: e === null ? null : { cent: null, teamSoll: e },
    });
    const zwei = ["A B", "C D"];
    expect(eintrag({ stufeId: "s_geplant", team: zwei, versionen: versionen(3, 2) }).karte.teamFehlt).toBe(true);
    expect(eintrag({ stufeId: "s_geplant", team: zwei, versionen: versionen(null, 2) }).karte.teamFehlt).toBe(false);
    expect(eintrag({ stufeId: "s_geplant", team: zwei, rechner: { festpreis: null, teamSoll: 3 } }).karte.teamFehlt).toBe(true);
  });
});

describe("laeuftGrund (Entscheidung 10)", () => {
  it("zukünftige Besichtigung mit Uhrzeit, als Tag ohne; vergangene zählt nicht", () => {
    expect(laeuftGrund(roh({ besichtigungAm: "2026-11-08T15:00:00.000Z" }), "open_engaged", JETZT)).toBe("Besichtigung So 08.11. 16:00");
    expect(laeuftGrund(roh({ besichtigungAm: "2026-11-06" }), "open_engaged", JETZT)).toBe("Besichtigung Fr 06.11.");
    expect(laeuftGrund(roh({ besichtigungAm: vor(60) }), "open_engaged", JETZT)).toBeNull();
    expect(laeuftGrund(roh({ besichtigungAm: "2026-11-05" }), "open_engaged", JETZT)).toBeNull();
  });
  it("Geplant mit Termin, sonst keiner", () => {
    expect(laeuftGrund(roh({ umzugAm: "2026-11-14" }), "booked", JETZT)).toBe("Termin Sa 14.11.");
    expect(laeuftGrund(roh({ umzugAm: "2026-11-14" }), "quoted", JETZT)).toBeNull();
    expect(laeuftGrund(roh(), "booked", JETZT)).toBeNull();
  });
  it("landet in der Pille „läuft · …“ nur ohne Warten", () => {
    expect(eintrag({ stufeId: "s_geplant", umzugAm: "2026-11-14" }).karte.wartet.text).toBe("läuft · Termin Sa 14.11.");
    expect(
      eintrag({ stufeId: "s_geplant", umzugAm: "2026-11-14", wartet: { auf: "uns", seit: vor(60), grund: "AB fehlt" } }).karte.wartet.text,
    ).toBe("Wartet auf uns · 1 Std");
  });
});

describe("kontextAus (Entscheidung 13)", () => {
  it("je Stufe höchstens ein Feld", () => {
    expect(kontextAus(roh({ fotos: 9 }), "open_engaged")).toBe("9 Fotos");
    expect(kontextAus(roh({ fotos: 1 }), "open_engaged")).toBe("1 Foto");
    expect(kontextAus(roh({ fotos: 0 }), "open_engaged")).toBeNull();
    expect(kontextAus(roh({ angebot: angebot({ gueltigBis: "2026-11-12" }) }), "quoted")).toBe("gültig bis 12.11.");
    expect(
      kontextAus(
        roh({
          angebot: angebot({ festpreisEuro: "1600" }),
          zahlungen: [
            { amount: "500", taxTreatment: "betriebseinnahme", date: "2026-11-01" },
            { amount: "300", taxTreatment: "nicht_steuerbar", date: "2026-11-02" },
          ],
        }),
        "done_unpaid",
      ),
    ).toBe("Rest 1.100 €");
    expect(kontextAus(roh({ angebot: angebot({ festpreisEuro: "500" }), zahlungen: [{ amount: "500", taxTreatment: null, date: "2026-11-01" }] }), "done_unpaid")).toBeNull();
    expect(
      kontextAus(
        roh({
          zahlungen: [
            { amount: "500", taxTreatment: null, date: "2026-11-01" },
            { amount: "100", taxTreatment: null, date: "2026-11-03" },
            { amount: "300", taxTreatment: "nicht_steuerbar", date: "2026-11-05" },
          ],
        }),
        "paid",
      ),
    ).toBe("bezahlt 03.11.");
    expect(kontextAus(roh({ fotos: 9 }), "booked")).toBeNull();
    expect(kontextAus(roh({ fotos: 9 }), "open_new")).toBeNull();
  });
});

describe("Chips „Heute im Blick“ (Entscheidung 6)", () => {
  it("warten: Pille auf uns, nie bei Endstufe", () => {
    expect(eintrag({ wartet: { auf: "uns", seit: vor(5), grund: null } }).chips).toContain("warten");
    expect(eintrag({ wartet: { auf: "kunde", seit: vor(5), grund: null } }).chips).not.toContain("warten");
    expect(eintrag({ stufeId: "s_bezahlt", wartet: { auf: "uns", seit: vor(5), grund: null } }).chips).not.toContain("warten");
  });

  it("KV ungesehen: Angebot, KV älter als 3 Tage, kein Portalaufruf seitdem (live gerechnet)", () => {
    const kv = (teil: Partial<LeadRoh>) =>
      eintrag({ stufeId: "s_angebot", angebot: angebot(), ...teil }).chips.includes("kv_ungesehen");
    expect(kv({ dokumente: { kvErstesAm: vor(4 * TAG), rechnungAm: null } })).toBe(true);
    expect(kv({ dokumente: { kvErstesAm: vor(3 * TAG), rechnungAm: null } })).toBe(false);
    expect(kv({ dokumente: { kvErstesAm: vor(2 * TAG), rechnungAm: null } })).toBe(false);
    expect(kv({ dokumente: { kvErstesAm: vor(4 * TAG), rechnungAm: null }, portalZuletztGeoeffnet: vor(TAG) })).toBe(false);
    expect(kv({ dokumente: { kvErstesAm: vor(4 * TAG), rechnungAm: null }, portalZuletztGeoeffnet: vor(5 * TAG) })).toBe(true);
    // gesendete Version vor dem Dokument (Regel der Akte)
    expect(
      kv({
        angebot: angebot({ ohneVersion: false }),
        versionen: { gesperrt: { version: 1, cent: null, gesendetAm: vor(5 * TAG), teamSoll: null }, entwurf: null },
      }),
    ).toBe(true);
    // Angebot mit Versionsbezug, aber nicht gesendet: das Dokument zählt nicht
    expect(kv({ angebot: angebot({ ohneVersion: false }), dokumente: { kvErstesAm: vor(5 * TAG), rechnungAm: null } })).toBe(false);
    // andere Kategorie
    expect(
      eintrag({ stufeId: "s_geplant", angebot: angebot(), dokumente: { kvErstesAm: vor(9 * TAG), rechnungAm: null } }).chips,
    ).not.toContain("kv_ungesehen");
  });

  it("Termin ohne Team: nur Geplant und teamFehlt", () => {
    expect(eintrag({ stufeId: "s_geplant" }).chips).toContain("ohne_team");
    expect(eintrag({ stufeId: "s_geplant", team: ["Max Kottke"] }).chips).not.toContain("ohne_team");
    expect(eintrag({ stufeId: "s_neu" }).chips).not.toContain("ohne_team");
  });

  it("Rechnung offen: Rechnung vorhanden und Rest über 0", () => {
    const mit = (teil: Partial<LeadRoh>) =>
      eintrag({ stufeId: "s_durch", dokumente: { kvErstesAm: null, rechnungAm: vor(TAG) }, ...teil }).chips.includes("rechnung_offen");
    expect(mit({ angebot: angebot({ festpreisEuro: "1600" }) })).toBe(true);
    expect(mit({ angebot: angebot({ festpreisEuro: "1600" }), zahlungen: [{ amount: "1600", taxTreatment: null, date: null }] })).toBe(false);
    expect(mit({ angebot: angebot({ istStunden: true }) })).toBe(false);
    expect(mit({})).toBe(false);
    expect(eintrag({ stufeId: "s_durch", angebot: angebot({ festpreisEuro: "1600" }) }).chips).not.toContain("rechnung_offen");
  });

  it("Umzug diese Woche: Montag bis Sonntag in Berlin, nur Geplant, Durchgeführt, Bezahlt", () => {
    const woche = (termin: string, stufeId = "s_geplant", jetzt = JETZT) =>
      eintrag({ stufeId, umzugAm: termin }, jetzt).chips.includes("diese_woche");
    expect(woche("2026-11-02")).toBe(true);
    expect(woche("2026-11-08")).toBe(true);
    expect(woche("2026-11-01")).toBe(false);
    expect(woche("2026-11-09")).toBe(false);
    expect(woche("2026-11-06", "s_durch")).toBe(true);
    expect(woche("2026-11-06", "s_bezahlt")).toBe(true);
    expect(woche("2026-11-06", "s_angebot")).toBe(false);
    // Sonntag 23:59 Berlin gehört noch zur alten Woche, Montag 00:00 zur neuen
    const sonntagSpaet = new Date("2026-11-08T22:59:00.000Z");
    const montagFrueh = new Date("2026-11-08T23:00:00.000Z");
    expect(woche("2026-11-08", "s_geplant", sonntagSpaet)).toBe(true);
    expect(woche("2026-11-08", "s_geplant", montagFrueh)).toBe(false);
    expect(woche("2026-11-09", "s_geplant", montagFrueh)).toBe(true);
  });

  it("chipsZaehlen zählt alle übergebenen Einträge", () => {
    const es = [
      eintrag({ id: "a", wartet: { auf: "uns", seit: vor(5), grund: null } }),
      eintrag({ id: "b", stufeId: "s_geplant", umzugAm: "2026-11-07", wartet: { auf: "uns", seit: vor(5), grund: "AB fehlt" } }),
      eintrag({ id: "c", stufeId: "s_verloren" }),
    ];
    expect(chipsZaehlen(es)).toEqual({ warten: 2, kv_ungesehen: 0, ohne_team: 1, rechnung_offen: 0, diese_woche: 1 });
  });
});

describe("filtern (Entscheidung 7)", () => {
  const alle = [
    eintrag({ id: "neu", stufeId: "s_neu", firmaId: "f_kottke", quelleId: "q_wa", wartet: { auf: "uns", seit: vor(5), grund: null } }),
    eintrag({ id: "kontakt", stufeId: "s_kontakt", firmaId: "f_ceylan", quelleId: "q_ka" }),
    eintrag({ id: "angebot", stufeId: "s_angebot", umzugAm: "2026-12-03" }),
    eintrag({ id: "geplant_nov", stufeId: "s_geplant", umzugAm: "2026-11-20" }),
    eintrag({ id: "geplant_offen", stufeId: "s_geplant" }),
    eintrag({ id: "durch_offen", stufeId: "s_durch" }),
    eintrag({ id: "ohne", stufeId: null }),
    eintrag({ id: "verloren", stufeId: "s_verloren" }),
    eintrag({ id: "kein", stufeId: "s_kein", terminAuswahl: "2026-11-11" }),
  ];

  it("Monat: Termin im Monat; ohne Termin nur Neue Anfrage, In Kontakt, Angebot", () => {
    expect(namen(filtern(alle, filter({ monat: "2026-11", endstufen: true })))).toEqual(["neu", "kontakt", "geplant_nov", "kein"]);
    expect(namen(filtern(alle, filter({ monat: "2026-12" })))).toEqual(["neu", "kontakt", "angebot"]);
  });

  it("ohne endstufen fallen Verloren und Kein Lead weg", () => {
    expect(namen(filtern(alle, filter()))).not.toContain("verloren");
    expect(namen(filtern(alle, filter()))).not.toContain("kein");
    expect(namen(filtern(alle, filter({ endstufen: true })))).toHaveLength(alle.length);
  });

  it("Firma, Quelle, Nur wartet, Chip", () => {
    expect(namen(filtern(alle, filter({ firmaId: "f_ceylan" })))).toEqual(["kontakt"]);
    expect(namen(filtern(alle, filter({ quelleId: "q_wa" })))).toEqual(["neu"]);
    expect(namen(filtern(alle, filter({ nurWartet: true })))).toEqual(["neu"]);
    expect(namen(filtern(alle, filter({ chip: "ohne_team" })))).toEqual(["geplant_nov", "geplant_offen"]);
  });
});

describe("Suche (Entscheidung 7)", () => {
  const e = eintrag({
    name: "Familie Weber",
    nummer: "2026-042",
    von: { city: "Stuttgart-Ost" },
    nach: "Bahnhofstr. 2, 70734 Fellbach",
    telefone: ["+49 170 1234567"],
  });
  it("Name, Ort, Deal-Nummer ohne Groß/Klein", () => {
    expect(passtSuche(e, "weber")).toBe(true);
    expect(passtSuche(e, "FELLBACH")).toBe(true);
    expect(passtSuche(e, "stuttgart-ost")).toBe(true);
    expect(passtSuche(e, "2026-042")).toBe(true);
    expect(passtSuche(e, "Esslingen")).toBe(false);
  });
  it("Telefon in Ziffern ab 4, führende Null egal", () => {
    expect(passtSuche(e, "0170 1234567")).toBe(true);
    expect(passtSuche(e, "+49 170 123")).toBe(true);
    expect(passtSuche(e, "01701234")).toBe(true);
    expect(passtSuche(e, "0171 999")).toBe(false);
    expect(passtSuche(e, "170")).toBe(false);
  });
  it("unter 2 Zeichen filtert nicht", () => {
    expect(passtSuche(e, "x")).toBe(true);
    expect(passtSuche(e, "  ")).toBe(true);
    expect(namen(filtern([e], filter({ suche: "z" })))).toEqual(["d1"]);
    expect(namen(filtern([e], filter({ suche: "zz" })))).toEqual([]);
  });
});

describe("sortierenInSpalte (Entscheidung 14)", () => {
  it("auf uns vor auf Kunden vor übrigen; längste Wartezeit oben, ohne Beginn am Ende; übrige nach Aktivität; Gleichstand nach ID", () => {
    const es = [
      eintrag({ id: "rest_alt", letzteNachrichtAm: vor(300) }),
      eintrag({ id: "kunde_kurz", wartet: { auf: "kunde", seit: vor(10), grund: null } }),
      eintrag({ id: "uns_ohne", wartet: { auf: "uns", seit: null, grund: null } }),
      eintrag({ id: "uns_kurz", wartet: { auf: "uns", seit: vor(10), grund: null } }),
      eintrag({ id: "rest_neu", letzteNachrichtAm: vor(5) }),
      eintrag({ id: "uns_lang", wartet: { auf: "uns", seit: vor(100), grund: null } }),
      eintrag({ id: "kunde_lang", wartet: { auf: "kunde", seit: vor(1000), grund: null } }),
      eintrag({ id: "b_gleich", letzteNachrichtAm: vor(50) }),
      eintrag({ id: "a_gleich", letzteNachrichtAm: vor(50) }),
    ];
    expect(namen(sortierenInSpalte(es))).toEqual([
      "uns_lang",
      "uns_kurz",
      "uns_ohne",
      "kunde_lang",
      "kunde_kurz",
      "rest_neu",
      "a_gleich",
      "b_gleich",
      "rest_alt",
    ]);
  });
});

describe("listeSortieren (Entscheidung 15)", () => {
  const es = [
    eintrag({ id: "a", stufeId: "s_geplant", umzugAm: "2026-11-20", angebot: angebot({ festpreisEuro: "900" }), quelleId: "q_wa" }),
    eintrag({ id: "b", stufeId: "s_neu", umzugAm: "2026-11-10", quelleId: "q_ka", wartet: { auf: "uns", seit: vor(10), grund: null } }),
    eintrag({ id: "c", stufeId: null, angebot: angebot({ festpreisEuro: "2000" }), wartet: { auf: "uns", seit: vor(100), grund: null } }),
    eintrag({ id: "d", stufeId: "s_alt", umzugAm: "2026-12-01", wartet: { auf: "kunde", seit: vor(500), grund: null } }),
  ];
  it("Wartezeit: ab = Board-Reihenfolge, auf dreht nur die Zeit innerhalb der Gruppen", () => {
    expect(namen(listeSortieren(es, { schluessel: "wartezeit", richtung: "ab" }, STUFEN))).toEqual(["c", "b", "d", "a"]);
    expect(namen(listeSortieren(es, { schluessel: "wartezeit", richtung: "auf" }, STUFEN))).toEqual(["b", "c", "d", "a"]);
  });
  it("Termin, Betrag, Quelle, Stufe: ohne Wert unten in beiden Richtungen", () => {
    expect(namen(listeSortieren(es, { schluessel: "termin", richtung: "auf" }, STUFEN))).toEqual(["b", "a", "d", "c"]);
    expect(namen(listeSortieren(es, { schluessel: "termin", richtung: "ab" }, STUFEN))).toEqual(["d", "a", "b", "c"]);
    expect(namen(listeSortieren(es, { schluessel: "betrag", richtung: "ab" }, STUFEN))).toEqual(["c", "a", "b", "d"]);
    expect(namen(listeSortieren(es, { schluessel: "betrag", richtung: "auf" }, STUFEN))).toEqual(["a", "c", "b", "d"]);
    expect(namen(listeSortieren(es, { schluessel: "quelle", richtung: "auf" }, STUFEN))).toEqual(["b", "a", "c", "d"]);
    // Stufe nach sort_order: Neue Anfrage 0, Quoted (inaktiv) 2, Geplant 3, ohne Stufe unten
    expect(namen(listeSortieren(es, { schluessel: "stufe", richtung: "auf" }, STUFEN))).toEqual(["b", "d", "a", "c"]);
    expect(namen(listeSortieren(es, { schluessel: "stufe", richtung: "ab" }, STUFEN))).toEqual(["a", "d", "b", "c"]);
  });
});

describe("seite", () => {
  const zehn = Array.from({ length: 10 }, (_, i) => i);
  it("Ausschnitt und Offset der nächsten Seite", () => {
    expect(seite(zehn, 0, 4)).toEqual({ teil: [0, 1, 2, 3], weiter: 4 });
    expect(seite(zehn, 8, 4)).toEqual({ teil: [8, 9], weiter: null });
    expect(seite(zehn, 6, 4)).toEqual({ teil: [6, 7, 8, 9], weiter: null });
    expect(seite(zehn, 20, 4)).toEqual({ teil: [], weiter: null });
    expect(seite(zehn, -3, 2)).toEqual({ teil: [0, 1], weiter: 2 });
  });
});

describe("spaltenBauen (Entscheidung 2 und 14)", () => {
  const mitBetrag = (id: string, stufeId: string | null, teil: Partial<LeadRoh> = {}) => eintrag({ id, stufeId, ...teil });

  it("Ohne Stufe links nur mit Karten, Board-Spalten in sort_order, Verloren und Kein Lead eingeklappt", () => {
    const ohne = spaltenBauen([mitBetrag("x", "s_neu")], STUFEN, filter());
    expect(ohne.map((s) => s.stufeId)).toEqual(["s_neu", "s_kontakt", "s_angebot", "s_geplant", "s_durch", "s_bezahlt", "s_verloren", "s_kein"]);
    const spalten = spaltenBauen(
      [mitBetrag("o", null), mitBetrag("v1", "s_verloren"), mitBetrag("v2", "s_verloren"), mitBetrag("a", "s_alt")],
      STUFEN,
      filter(),
    );
    expect(spalten[0]).toMatchObject({ stufeId: OHNE_STUFE, label: "Ohne Stufe", kategorie: null, ton: "grau", anzahl: 1 });
    expect(spalten.find((s) => s.stufeId === "s_angebot")).toMatchObject({
      label: "Angebot",
      ton: "blau_tief",
      satz: "KV raus, wartet auf Annahme",
      anzahl: 1,
      eingeklappt: false,
    });
    expect(spalten.find((s) => s.stufeId === "s_verloren")).toMatchObject({ anzahl: 2, karten: [], weiter: null, eingeklappt: true });
    const offen = spaltenBauen([mitBetrag("v1", "s_verloren")], STUFEN, filter({ endstufen: true }));
    expect(offen.find((s) => s.stufeId === "s_verloren")).toMatchObject({ anzahl: 1, eingeklappt: false });
    expect(offen.find((s) => s.stufeId === "s_verloren")?.karten.map((k) => k.id)).toEqual(["v1"]);
  });

  it("Anzahl und Summe über die ganze Spalte, Karten nur die erste Seite", () => {
    const viele = Array.from({ length: 45 }, (_, i) =>
      mitBetrag(`d${String(i).padStart(2, "0")}`, "s_angebot", { angebot: angebot({ festpreisEuro: "100" }) }),
    );
    const s = spaltenBauen(viele, STUFEN, filter()).find((x) => x.stufeId === "s_angebot");
    expect(s).toMatchObject({ anzahl: 45, summeCent: 450000, summeGeschaetzt: false, weiter: BOARD_SEITE });
    expect(s?.karten).toHaveLength(BOARD_SEITE);
  });

  it("„~“ sobald ein Betrag geschätzt ist, unplausible Beträge gekappt, ohne Beträge null", () => {
    const s = spaltenBauen(
      [
        mitBetrag("a", "s_angebot", { angebot: angebot({ festpreisEuro: "1000" }) }),
        mitBetrag("b", "s_angebot", { wert: { amount: 500 } }),
        mitBetrag("c", "s_angebot", { angebot: angebot({ festpreisEuro: "900000" }) }),
        mitBetrag("d", "s_angebot"),
      ],
      STUFEN,
      filter(),
    ).find((x) => x.stufeId === "s_angebot");
    expect(s).toMatchObject({ anzahl: 4, summeCent: 150000, summeGeschaetzt: true });
    const leer = spaltenBauen([mitBetrag("d", "s_angebot")], STUFEN, filter()).find((x) => x.stufeId === "s_angebot");
    expect(leer).toMatchObject({ summeCent: null, summeGeschaetzt: false });
    const unplausibelGeschaetzt = spaltenBauen(
      [mitBetrag("a", "s_angebot", { angebot: angebot({ festpreisEuro: "1000" }) }), mitBetrag("b", "s_angebot", { wert: { amount: 900000 } })],
      STUFEN,
      filter(),
    ).find((x) => x.stufeId === "s_angebot");
    expect(unplausibelGeschaetzt).toMatchObject({ summeCent: 100000, summeGeschaetzt: false });
  });

  it("Karten in der Spalte in Board-Reihenfolge", () => {
    const s = spaltenBauen(
      [mitBetrag("rest", "s_neu", { letzteNachrichtAm: vor(1) }), mitBetrag("uns", "s_neu", { wartet: { auf: "uns", seit: vor(9), grund: null } })],
      STUFEN,
      filter(),
    ).find((x) => x.stufeId === "s_neu");
    expect(s?.karten.map((k) => k.id)).toEqual(["uns", "rest"]);
  });
});
