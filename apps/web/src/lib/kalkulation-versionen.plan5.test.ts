/**
 * Plan 5b, Task K: reine Teile (neue Anpassungsarten, Paket- und Tagespreise in der
 * Version, eine Sperr-Regel, Wahl beim Sperren) und die Kalkulationsansicht mit
 * Firmen-Schalter. Posten je Wahl (Task P) sind ersetzt: ein Kern-Posten je Wahl.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/rechner/wahl-posten", () => ({
  postenJeWahl: vi.fn((input: { version: import("./angebot-wahl").VersionsPreise }) => {
    const v = input.version;
    const kern = (eur: number | null) => (eur === null ? [] : [{ description: "Umzugsteam & Transporter", quantity: 1, unitRate: eur }]);
    return {
      ...v,
      packagePrices: v.packagePrices.map((p) => ({ ...p, kvItems: kern(p.festpreis) })),
      dayPrices: v.dayPrices.map((t) => ({ ...t, kvItems: kern(t.festpreis), paketpreise: t.paketpreise?.map((p) => ({ ...p, kvItems: kern(p.festpreis) })) ?? null })),
    };
  }),
  stundenPosten: vi.fn(),
}));

import { PLAN5_FEHLER_TEXT, preisHash, type PaketpreisVersion, type Tagespreis, type VersionsPreise } from "./angebot-wahl";
import {
  kundenPreiseOhnePosten,
  paketpreiseAus,
  preisModusAus,
  pruefeUebersteuerung,
  sperrBefund,
  sperrWahl,
  tagespreiseAus,
  tagespreisAnpassung,
  paketpreisUnterGrenzeAmTag,
  UebersteuerungFehler,
  type SperrRegel,
  type Uebersteuerung,
} from "./kalkulation-versionen";
import { ansichtAus, type AnsichtRest } from "./kalkulations-ansicht";
import { WEBER_JETZT, weberVersion } from "./kalkulations-ansicht.fixture";

const u = (art: Uebersteuerung["art"], key: string, wert: Uebersteuerung["wert"], grund = "Grund"): Uebersteuerung => ({
  id: `${art}:${key}:${JSON.stringify(wert)}`, art, key, rechnerwert: null, wert, grund,
  autor: { userId: "usr_1", quelle: "mensch" }, zeit: "2026-11-06T10:00:00.000Z", fotoRef: null,
});

describe("pruefeUebersteuerung: neue Arten (Entscheidung 4)", () => {
  it("Paketpreis und Tagespreis: Betrag > 0 als { betrag } (auch Zahl oder Text), Schlüssel Slug bzw. Datum[:slug]", () => {
    expect(pruefeUebersteuerung({ art: "paketpreis", key: "komfort", wert: "1390,5", grund: "x" })).toMatchObject({ wert: { betrag: 1390.5 } });
    expect(pruefeUebersteuerung({ art: "tagespreis", key: "2026-11-21:basis", wert: { betrag: 990 }, grund: "x" })).toMatchObject({ wert: { betrag: 990 } });
    expect(pruefeUebersteuerung({ art: "tagespreis", key: "2026-11-21", wert: null, grund: "zurück" }).wert).toBeNull();
    for (const e of [
      { art: "paketpreis", key: "Komfort Plus", wert: 1, grund: "x" },
      { art: "paketpreis", key: "komfort", wert: 0, grund: "x" },
      { art: "tagespreis", key: "2026-02-30", wert: 1, grund: "x" },
      { art: "tagespreis", key: "2026-11-21:a:b", wert: 1, grund: "x" },
      { art: "kv_darstellung", key: "kv", wert: "zusammen", grund: "x" },
      { art: "preismodus", key: "modus", wert: "pauschal", grund: "x" },
      { art: "paketpreis", key: "komfort", wert: 1390, grund: "  " },
    ]) {
      expect(() => pruefeUebersteuerung(e)).toThrow(UebersteuerungFehler);
    }
    expect(pruefeUebersteuerung({ art: "kv_darstellung", key: "kv", wert: "ein_posten", grund: "x" }).wert).toBe("ein_posten");
    expect(preisModusAus([u("preismodus", "modus", "stunden"), u("preismodus", "modus", null)])).toBe("fest");
  });
});

describe("Paket- und Tagespreise der Version", () => {
  it("Anpassung setzt den wirksamen Preis, Rechnerwert bleibt; Tage nach Datum, fehlender Rechnertag ohne Preis", () => {
    const pakete = paketpreiseAus([{ slug: "basis", festpreis: 1290, selbstkosten: 700 }, { slug: "komfort", festpreis: 1490, selbstkosten: 800 }], [
      u("paketpreis", "komfort", { betrag: 1390 }, "Stammkunde"),
    ]);
    expect(pakete.map((p) => [p.slug, p.festpreis, p.rechnerFestpreis, p.uebersteuert])).toEqual([
      ["basis", 1290, 1290, null],
      ["komfort", 1390, 1490, { betrag: 1390, grund: "Stammkunde" }],
    ]);
    const tage = tagespreiseAus(
      [{ datum: "2026-11-21", wochentag: "sa", feiertag: false, festpreis: 1590, selbstkosten: 800, margeProzent: 45, gruende: [], paketpreise: [{ slug: "basis", festpreis: 1390, selbstkosten: 700 }] }],
      [
        { datum: "2026-11-27", slots: [], note: null, empfohlen: false },
        { datum: "2026-11-21", slots: [], note: "Sa", empfohlen: true },
      ],
      [u("tagespreis", "2026-11-21:basis", { betrag: 1290 })]
    );
    expect(tage.map((t) => [t.datum, t.festpreis, t.wochentag, t.paketpreise?.[0]?.festpreis ?? null])).toEqual([
      ["2026-11-21", 1590, "sa", 1290],
      ["2026-11-27", null, "fr", null],
    ]);
  });

  it("Paketpreis-Anpassung wirkt an jedem Tag als Differenz zum Rechnerpreis am Basistag; eigene Tagesanpassung geht vor (F2, I3)", () => {
    const rechner = [
      { datum: "2026-11-20", wochentag: "fr" as const, feiertag: false, festpreis: 1810, selbstkosten: 1100, margeProzent: 38, gruende: [], paketpreise: [{ slug: "komfort", festpreis: 1480, selbstkosten: 1000 }] },
      { datum: "2026-11-21", wochentag: "sa" as const, feiertag: false, festpreis: 1870, selbstkosten: 1150, margeProzent: 38, gruende: [], paketpreise: [{ slug: "komfort", festpreis: 1540, selbstkosten: 1050 }] },
    ];
    const konfig = [
      { datum: "2026-11-20", slots: [], note: null, empfohlen: true },
      { datum: "2026-11-21", slots: [], note: null, empfohlen: false },
    ];
    // Rechnerpreis am Basistag 1.480, Anpassung 1.550: Differenz +70 an jedem Tag.
    const basis = [{ slug: "komfort", festpreis: 1480, selbstkosten: 1000 }];
    const paket = u("paketpreis", "komfort", { betrag: 1550 }, "Dritter Helfer");
    const komfort = (t: Tagespreis[]) => t.map((x) => [x.datum, x.paketpreise?.[0]?.festpreis, x.paketpreise?.[0]?.uebersteuert?.grund ?? null]);
    expect(komfort(tagespreiseAus(rechner, konfig, [paket], basis))).toEqual([
      ["2026-11-20", 1550, "Dritter Helfer"],
      ["2026-11-21", 1610, "Dritter Helfer"],
    ]);
    // Nach unten genauso (Differenz −80), Rechnerwert bleibt sichtbar.
    const billiger = tagespreiseAus(rechner, konfig, [u("paketpreis", "komfort", { betrag: 1400 }, "Stammkunde")], basis);
    expect(billiger.map((t) => [t.paketpreise?.[0]?.festpreis, t.paketpreise?.[0]?.rechnerFestpreis])).toEqual([[1400, 1480], [1460, 1540]]);
    // Ohne Basis-Paketpreise (Schalter „Angebot aus Kalkulation“ aus): keine Wirkung an Tagen.
    expect(komfort(tagespreiseAus(rechner, konfig, [paket], null))).toEqual([["2026-11-20", 1480, null], ["2026-11-21", 1540, null]]);
    // Ohne Rechnerpreis am Basistag gibt es keine Differenz: der Tag behält den Rechnerpreis.
    expect(komfort(tagespreiseAus(rechner, konfig, [paket], [{ slug: "komfort", festpreis: null, selbstkosten: 0 }]))[1]).toEqual(["2026-11-21", 1540, null]);
    // Eigene Anpassung am Tag geht vor; aufgehoben gilt wieder die Differenz.
    const tag = u("tagespreis", "2026-11-21:komfort", { betrag: 1600 }, "Samstag knapp");
    expect(komfort(tagespreiseAus(rechner, konfig, [paket, tag], basis))).toEqual([
      ["2026-11-20", 1550, "Dritter Helfer"],
      ["2026-11-21", 1600, "Samstag knapp"],
    ]);
    const weg = { ...u("tagespreis", "2026-11-21:komfort", null, "Im Termin-Dialog entfernt"), id: "weg" };
    expect(komfort(tagespreiseAus(rechner, konfig, [paket, tag, weg], basis))[1]).toEqual(["2026-11-21", 1610, "Dritter Helfer"]);
    // Aufgehobene Paketanpassung: wieder der Rechner.
    const aus = { ...u("paketpreis", "komfort", null, "zurück"), id: "aus" };
    expect(komfort(tagespreiseAus(rechner, konfig, [paket, aus], basis))).toEqual([["2026-11-20", 1480, null], ["2026-11-21", 1540, null]]);
    // Die Ansicht trennt: eigens gesetzt je Paket am Tag nur die Tagesanpassung.
    expect(tagespreisAnpassung([paket, tag], "2026-11-21", "komfort")).toEqual({ betrag: 1600, grund: "Samstag knapp" });
    expect(tagespreisAnpassung([paket], "2026-11-21", "komfort")).toBeNull();
    expect(tagespreisAnpassung([paket, tag, weg], "2026-11-21", "komfort")).toBeNull();
  });

  it("Untergrenze je Tag: die Differenz darf an keinem Tag unter 30 % Marge fallen; eigene Tagesanpassung zählt nicht (F2, I3)", () => {
    const rechner = [
      { datum: "2026-11-20", wochentag: "fr" as const, feiertag: false, festpreis: 1810, selbstkosten: 1100, margeProzent: 38, gruende: [], paketpreise: [{ slug: "komfort", festpreis: 1480, selbstkosten: 1000, rundungEur: 10 }] },
      { datum: "2026-11-21", wochentag: "sa" as const, feiertag: false, festpreis: 1870, selbstkosten: 1150, margeProzent: 38, gruende: [], paketpreise: [{ slug: "komfort", festpreis: 1500, selbstkosten: 1200, rundungEur: 10 }] },
    ];
    const konfig = [
      { datum: "2026-11-20", slots: [], note: null, empfohlen: true },
      { datum: "2026-11-21", slots: [], note: null, empfohlen: false },
    ];
    const basis = [{ slug: "komfort", festpreis: 1480, selbstkosten: 1000 }];
    const grenze = (p: PaketpreisVersion) => Math.ceil((p.selbstkosten * 1.3) / 10) * 10;
    // −50: am 20. 1.430 (Grenze 1.300), am 21. 1.450 (Grenze 1.560): am 21. zu tief.
    const tief = [u("paketpreis", "komfort", { betrag: 1430 }, "Rabatt")];
    expect(paketpreisUnterGrenzeAmTag(tagespreiseAus(rechner, konfig, tief, basis), tief, grenze)).toEqual({ datum: "2026-11-21", slug: "komfort", grenze: 1560 });
    // Mit eigener Anpassung am 21. greift die Prüfung der Tagesanpassung, nicht diese.
    const mitTag = [...tief, u("tagespreis", "2026-11-21:komfort", { betrag: 1600 }, "fest")];
    expect(paketpreisUnterGrenzeAmTag(tagespreiseAus(rechner, konfig, mitTag, basis), mitTag, grenze)).toBeNull();
  });

  it("sperrWahl: Kundenwahl bleibt, solange angeboten; sonst Standardwahl", () => {
    const tag = (datum: string, preis: number): Tagespreis => ({
      datum, wochentag: "sa", feiertag: false, festpreis: preis, rechnerFestpreis: preis, selbstkosten: 0, margeProzent: null, gruende: [],
      uebersteuert: null, paketpreise: [{ slug: "basis", festpreis: preis - 200, selbstkosten: 0, kvItems: [{ description: "K", quantity: 1, unitRate: preis - 200 }] }],
      kvItems: [{ description: "K", quantity: 1, unitRate: preis }], slots: [], note: null, empfohlen: datum === "2026-11-21", vehicleBookingId: null,
    });
    const p: VersionsPreise = {
      pricingMode: "fest", priceCents: 159000, kvItems: [],
      packagePrices: [{ slug: "basis", festpreis: 1290, selbstkosten: 0, kvItems: [{ description: "K", quantity: 1, unitRate: 1290 }] } as PaketpreisVersion],
      dayPrices: [tag("2026-11-20", 1490), tag("2026-11-21", 1590)],
    };
    const standard = { paketSlug: "basis", datum: "2026-11-21" };
    expect(sperrWahl(p, standard, { paketSlug: "basis", datum: "2026-11-20" })).toMatchObject({ wahl: { paketSlug: "basis", datum: "2026-11-20" }, preis: { priceCents: 129000 } });
    expect(sperrWahl(p, standard, { paketSlug: "premium", datum: "2026-11-28" })?.wahl).toEqual(standard);
    // F2 (M3): wie `kundenwahlAnwenden` kein weiterer Rückfall. Hat Basis am 20. keinen Preis,
    // gibt es keine Wahl (das Sperren lehnt mit Hinweis ab), nicht still Basis am Standardtag.
    const ohne = { ...p, dayPrices: p.dayPrices.map((t) => (t.datum === "2026-11-20" ? { ...t, paketpreise: t.paketpreise!.map((x) => ({ ...x, festpreis: null })) } : t)) };
    expect(sperrWahl(ohne, standard, { paketSlug: "basis", datum: "2026-11-20" })).toBeNull();
    expect(sperrWahl(ohne, standard, { paketSlug: "basis", datum: "2026-11-21" })?.preis.priceCents).toBe(139000);
  });
});

describe("sperrBefund: eine Regel für Dienst und Seite", () => {
  const basis: SperrRegel = {
    schalter: { angebotAusKalkulation: true, tagespreise: true }, autor: "mensch", hatPakete: true, angebotIstStunden: false,
    pricingMode: "fest", modusWechselBestaetigt: false, tage: 0,
  };
  const preise = (felder: Partial<NonNullable<SperrRegel["preise"]>> = {}): NonNullable<SperrRegel["preise"]> => ({
    pakete: [{ slug: "basis", preis: 1290, hebel: [], uebersteuert: false }, { slug: "komfort", preis: 1490, hebel: ["montage"], uebersteuert: false }],
    stunden: null, istKottke: false, kerne: [{ art: "ok" }], anzahlungPasst: true, ...felder,
  });
  it.each([
    ["ohne Schalter Pakete", { schalter: { angebotAusKalkulation: false, tagespreise: false } }, "PAKETE"],
    ["ohne Schalter Stunden-Version", { schalter: { angebotAusKalkulation: false, tagespreise: false }, hatPakete: false, pricingMode: "stunden" as const }, "STUNDEN"],
    ["Agent mit Tagen", { autor: "agent" as const, tage: 2 }, "TAGESPREIS_NUR_MENSCH"],
    ["Agent im Stundenmodus", { autor: "agent" as const, hatPakete: false, pricingMode: "stunden" as const }, "STUNDEN_NUR_MENSCH"],
    ["Agent: Stunden-KV wird Festpreis", { autor: "agent" as const, angebotIstStunden: true, modusWechselBestaetigt: true }, "STUNDEN_NUR_MENSCH"],
    ["Mensch ohne Bestätigung", { angebotIstStunden: true }, "MODUSWECHSEL"],
  ] as const)("%s → %s", (_n, felder, code) => {
    expect(sperrBefund({ ...basis, ...felder })?.code).toBe(code);
  });
  it.each([
    ["frei angelegte Option", { pakete: [{ slug: null, preis: null, hebel: null, uebersteuert: false }] }, "PAKET_OHNE_PREIS"],
    ["Komfort ohne Hebel", { pakete: [{ slug: "komfort", preis: 1490, hebel: [], uebersteuert: false }] }, "PAKET_OHNE_HEBEL"],
    ["Kern negativ", { kerne: [{ art: "ok" as const }, { art: "negativ" as const }] }, "KERN_NEGATIV"],
    ["Anzahlung", { anzahlungPasst: false }, "ANZAHLUNG_UEBER_PREIS"],
    ["Kottke mit Zusatzposten", { stunden: { kalkulierbar: true, hinweis: null, zusatzposten: 1 }, istKottke: true }, "STUNDEN_ZUSATZ_VPS"],
    ["Kottke mit 2 Transportern", { stunden: { kalkulierbar: true, hinweis: null, zusatzposten: 0, transporter: 2 }, istKottke: true }, "STUNDEN_TRANSPORTER_VPS"],
    ["Kottke ohne Transporter", { stunden: { kalkulierbar: true, hinweis: null, zusatzposten: 0, transporter: 0 }, istKottke: true }, "STUNDEN_TRANSPORTER_VPS"],
  ] as const)("%s → %s, Text aus PLAN5_FEHLER_TEXT", (_n, felder, code) => {
    const r = sperrBefund({ ...basis, preise: preise(felder as Partial<NonNullable<SperrRegel["preise"]>>) });
    expect(r).toEqual({ code, text: PLAN5_FEHLER_TEXT[code] });
  });
  it("K1: Kottke mit genau einem Transporter sperrt; andere Firmen auch mit 0 oder 2 Transportern", () => {
    const stunden = (transporter: number) => ({ kalkulierbar: true, hinweis: null, zusatzposten: 0, transporter });
    expect(sperrBefund({ ...basis, preise: preise({ stunden: stunden(1), istKottke: true }) })).toBeNull();
    expect(sperrBefund({ ...basis, preise: preise({ stunden: stunden(2), istKottke: false }) })).toBeNull();
    expect(sperrBefund({ ...basis, preise: preise({ stunden: stunden(0), istKottke: false }) })).toBeNull();
    expect(PLAN5_FEHLER_TEXT.STUNDEN_TRANSPORTER_VPS).not.toMatch(/[—–]/);
  });
  it("Basis ohne Hebel, begründeter Preis ohne Hebel und kleiner Kern sperren nicht; Mensch mit Bestätigung auch nicht", () => {
    expect(sperrBefund({ ...basis, preise: preise({ kerne: [{ art: "klein", anteil: 0.3 }] }) })).toBeNull();
    expect(sperrBefund({ ...basis, preise: preise({ pakete: [{ slug: "einzeltransport", preis: 690, hebel: [], uebersteuert: true }] }) })).toBeNull();
    expect(sperrBefund({ ...basis, angebotIstStunden: true, modusWechselBestaetigt: true })).toBeNull();
  });
});

describe("ansichtAus mit Firmen-Schalter (Plan 5b)", () => {
  const rest = (felder: Partial<AnsichtRest> = {}): AnsichtRest => ({
    alle: [{ version: 2, status: "entwurf", priceCents: 248000 }], namen: {}, deal: { name: "Weber", art: "Umzug", strecke: "", termin: "2026-11-21", aktenLink: "/a" },
    inventar: [], fotos: [], vorlagen: [], angebot: null, veraltet: false, kvDokument: null, jetzt: WEBER_JETZT, renderer: "crm",
    hatPakete: true, paketNamen: { basis: "Basis", komfort: "Komfort" },
    schalter: { angebotAusKalkulation: true, tagespreise: true },
    paketOptionen: [{ catalogueSlug: "basis", isRecommended: false }, { catalogueSlug: "komfort", isRecommended: true }],
    paketHebel: { basis: [], komfort: ["halteverbot", "montage"] },
    ...felder,
  });
  const pakete: PaketpreisVersion[] = [
    { slug: "basis", festpreis: 1990, rechnerFestpreis: 1990, selbstkosten: 1300, rundungEur: 10, uebersteuert: null },
    { slug: "komfort", festpreis: 2290, rechnerFestpreis: 2480, selbstkosten: 1500, rundungEur: 10, uebersteuert: { betrag: 2290, grund: "Stammkunde" } },
  ];

  it("Pakete mit Anpassung, Untergrenze, Hebeln und Kern; Preis-Hash wie beim Sperren; Schalter durchgereicht", () => {
    const v = weberVersion({ packagePrices: pakete });
    const a = ansichtAus(v, rest());
    expect(a.schalter).toEqual({ angebotAusKalkulation: true, tagespreise: true });
    expect(a.pakete[1]).toMatchObject({
      slug: "komfort", name: "Komfort", preisCent: 229000, rechnerPreisCent: 248000,
      uebersteuert: { betragCent: 229000, grund: "Stammkunde" }, untergrenzeCent: 215000, hebel: ["halteverbot", "montage"], kern: { art: "ein_posten" },
    });
    // Hash über alle Kundenpreise, Standardwahl = empfohlenes Paket (Komfort).
    expect(a.preisHash).toBe(
      preisHash(kundenPreiseOhnePosten({
        schalter: { angebotAusKalkulation: true, tagespreise: true }, pricingMode: "fest", hauptCent: a.kv!.summeCent,
        packagePrices: pakete, dayPrices: [], stundenCent: null, empfohlenesPaket: "komfort",
      }))
    );
    expect(a.preisHash).toMatch(/^-@-=229000\|basis@-=199000\|komfort@-=229000$/);
    expect(a.kv?.summeCent).toBe(229000);
    expect(a.version).toMatchObject({ sperrbar: true, sperrGrund: null });
  });

  it("dieselben Sperrgründe wie der Dienst: Paket ohne Hebel, Anzahlung über einem Preis", () => {
    const v = weberVersion({ packagePrices: pakete });
    // Komfort ohne Hebel: mit begründetem Preis sperrbar (F7), mit dem Rechnerpreis nicht.
    expect(ansichtAus(v, rest({ paketHebel: { basis: [], komfort: [] } })).version.sperrGrund).toBeNull();
    const ohneAnpassung = weberVersion({ packagePrices: [pakete[0], { ...pakete[1], festpreis: 2480, uebersteuert: null }] });
    expect(ansichtAus(ohneAnpassung, rest({ paketHebel: { basis: [], komfort: [] } })).version.sperrGrund).toBe(PLAN5_FEHLER_TEXT.PAKET_OHNE_HEBEL);
    expect(ansichtAus(v, rest({ angebot: { notes: null, isVariable: false, validUntil: null, depositRequiredCents: 199000 } })).version.sperrGrund).toBe(
      PLAN5_FEHLER_TEXT.ANZAHLUNG_UEBER_PREIS
    );
  });

  it("Tage und Stunden aus der Version; Stunden ohne Posten-Tabelle; KV-Darstellung", () => {
    const tag: Tagespreis = {
      datum: "2026-11-21", wochentag: "sa", feiertag: false, festpreis: 2580, rechnerFestpreis: 2580, selbstkosten: 1500, margeProzent: 45,
      gruende: [{ text: "Samstag", punkte: 5 }], uebersteuert: null, paketpreise: [{ slug: "basis", festpreis: 2090, selbstkosten: 1300 }],
      slots: [{ label: "Vormittag", startTime: "08:00", endTime: null }], note: null, empfohlen: true, vehicleBookingId: null,
    };
    const a = ansichtAus(weberVersion({ dayPrices: [tag] }), rest({ paketOptionen: [], hatPakete: false }));
    expect(a.tage).toEqual([
      {
        datum: "2026-11-21", text: "Sa 21.11.", feiertag: false, empfohlen: true, preisCent: 258000, rechnerPreisCent: 258000, uebersteuert: null,
        gruende: [{ text: "Samstag", punkte: 5 }], paketPreiseCent: { basis: 209000 }, paketUebersteuert: {}, slots: tag.slots, note: null,
      },
    ]);
    const s = weberVersion({
      pricingMode: "stunden",
      overrides: [u("preismodus", "modus", "stunden"), u("kv_darstellung", "kv", "ein_posten")],
    });
    s.rechnerResult = {
      ...s.rechnerResult!,
      stunden: { helfer: 3, transporter: 1, stundenGeschaetzt: 6.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25, zusatzposten: [{ key: "h", bezeichnung: "Halteverbot", betrag: 150 }], summeGeschaetztEur: 995, mindestbetragEur: 390 },
    };
    const b = ansichtAus(s, rest({ paketOptionen: [], hatPakete: false }));
    expect(b.stunden).toMatchObject({ helfer: 3, summeGeschaetztCent: 99500, mindestbetragCent: 39000, zusatzposten: [{ bezeichnung: "Halteverbot", betragCent: 15000 }] });
    expect(b.kv).toBeNull();
    expect(b.version.preisModus).toBe("stunden");
    expect(b.kvDarstellung).toBe("ein_posten");
    expect(b.anpassungen.map((x) => x.art)).not.toContain("preismodus");
  });

  it("ohne Schalter: keine Tage, kein Hash, Pakete wie vorher", () => {
    const a = ansichtAus(weberVersion({ packagePrices: pakete }), rest({ schalter: undefined, hatPakete: true }));
    expect(a).toMatchObject({ tage: [], stunden: null, kern: null, preisHash: null, kvDarstellung: "posten", schalter: { angebotAusKalkulation: false, tagespreise: false } });
    expect(a.pakete[0]).toEqual({ slug: "basis", name: "Basis", preisCent: 199000, hinweis: null });
  });
});
