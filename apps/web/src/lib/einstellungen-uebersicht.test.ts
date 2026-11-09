import { describe, expect, it } from "vitest";
import { ZAHLUNGSREGEL_STANDARD } from "@/lib/geld";
import {
  abschlussJeMonat,
  aktiverTarifFuer,
  anfragenJeMonat,
  apiSchluesselAnsicht,
  apiSchluesselSortieren,
  darstellungAus,
  darstellungPruefen,
  durchfuehrungsTag,
  durchgefuehrtJeMonat,
  hebelUmschalten,
  kalenderAboUrl,
  monateBis,
  neueZeitpostenId,
  OHNE_QUELLE,
  portalSchalterPatch,
  stammdatenAus,
  tarifAus,
  webcalUrl,
  zahlungsregelText,
  zuflussJeMonat,
  zuletztBenutztText,
  type ApiSchluesselAnsicht,
  type UebersichtDeal,
} from "./einstellungen-uebersicht";

const JETZT = new Date("2026-11-08T10:00:00Z");
const TAG = 86_400_000;

describe("Darstellung", () => {
  it("prüft die drei Werte, sonst null", () => {
    for (const d of ["hell", "dunkel", "system"]) expect(darstellungPruefen(d)).toBe(d);
    for (const x of ["Hell", "DUNKEL", 1, null, undefined, { d: "hell" }]) expect(darstellungPruefen(x)).toBeNull();
  });
  it("liest gespeicherten Wert, sonst Standard", () => {
    expect(darstellungAus(undefined)).toBe("system");
    expect(darstellungAus(null)).toBe("system");
    expect(darstellungAus({})).toBe("system");
    expect(darstellungAus({ darstellung: "dunkel" })).toBe("dunkel");
    expect(darstellungAus({ darstellung: "nacht" })).toBe("system");
  });
});

describe("Kalender-Abo", () => {
  it("volle Adresse mit und ohne Firma, vorhandene Query bleibt", () => {
    expect(kalenderAboUrl("https://crm.test", "/api/calendar/ics/t.ics")).toBe("https://crm.test/api/calendar/ics/t.ics");
    expect(kalenderAboUrl("https://crm.test", "/api/calendar/ics/t.ics", "oc1")).toBe("https://crm.test/api/calendar/ics/t.ics?company=oc1");
    expect(kalenderAboUrl("https://crm.test", "/x.ics?a=1", "oc1")).toBe("https://crm.test/x.ics?a=1&company=oc1");
  });
  it("webcal aus https und http", () => {
    expect(webcalUrl("https://crm.test/x.ics")).toBe("webcal://crm.test/x.ics");
    expect(webcalUrl("http://crm.test/x.ics")).toBe("webcal://crm.test/x.ics");
  });
});

describe("API-Schlüssel", () => {
  const roh = (o: Partial<Parameters<typeof apiSchluesselAnsicht>[0]> = {}) => ({
    id: "k",
    name: "K",
    keyPrefix: "ock_",
    scopes: ["read"] as unknown,
    createdAt: new Date("2026-01-01T00:00:00Z") as Date | null,
    lastUsedAt: new Date(JETZT.getTime() - TAG) as Date | string | null,
    expiresAt: null as Date | string | null,
    ...o,
  });

  it("Zugriff aus den Scopes, unlesbar ist voll", () => {
    expect(apiSchluesselAnsicht(roh(), JETZT).zugriff).toBe("lesen");
    expect(apiSchluesselAnsicht(roh({ scopes: '["read"]' }), JETZT).zugriff).toBe("lesen");
    expect(apiSchluesselAnsicht(roh({ scopes: "kaputt" }), JETZT).zugriff).toBe("voll");
    expect(apiSchluesselAnsicht(roh({ scopes: null }), JETZT).zugriff).toBe("voll");
    expect(apiSchluesselAnsicht(roh({ scopes: ["read", "write"] }), JETZT).zugriff).toBe("voll");
  });

  it("abgelaufen: Vergangenheit und genau jetzt ja, Zukunft und null nein", () => {
    expect(apiSchluesselAnsicht(roh({ expiresAt: new Date(JETZT.getTime() - 1) }), JETZT).abgelaufen).toBe(true);
    expect(apiSchluesselAnsicht(roh({ expiresAt: JETZT.toISOString() }), JETZT).abgelaufen).toBe(true);
    expect(apiSchluesselAnsicht(roh({ expiresAt: new Date(JETZT.getTime() + TAG) }), JETZT).abgelaufen).toBe(false);
    expect(apiSchluesselAnsicht(roh(), JETZT).abgelaufen).toBe(false);
  });

  it("ungenutzt: nie benutzt oder älter als 30 Tage", () => {
    expect(apiSchluesselAnsicht(roh({ lastUsedAt: null }), JETZT).ungenutzt).toBe(true);
    expect(apiSchluesselAnsicht(roh({ lastUsedAt: new Date(JETZT.getTime() - 31 * TAG) }), JETZT).ungenutzt).toBe(true);
    expect(apiSchluesselAnsicht(roh({ lastUsedAt: new Date(JETZT.getTime() - 29 * TAG).toISOString() }), JETZT).ungenutzt).toBe(false);
  });

  it("ohne Anlagedatum gilt jetzt", () => {
    expect(apiSchluesselAnsicht(roh({ createdAt: null }), JETZT).erstelltAm).toBe(JETZT.toISOString());
  });

  it("zuletztBenutztText in Berliner Tagen", () => {
    expect(zuletztBenutztText(null, JETZT)).toBe("nie benutzt");
    expect(zuletztBenutztText("2026-11-08T05:00:00Z", JETZT)).toBe("heute");
    // 22:30 UTC = 23:30 Berlin am 07.11.; eine Stunde später ist in Berlin schon der 08.11.
    expect(zuletztBenutztText("2026-11-07T22:30:00Z", new Date("2026-11-07T22:50:00Z"))).toBe("heute");
    expect(zuletztBenutztText("2026-11-07T22:30:00Z", new Date("2026-11-07T23:30:00Z"))).toBe("gestern");
    expect(zuletztBenutztText("2026-11-07T22:30:00Z", new Date("2026-11-08T23:30:00Z"))).toBe("vor 2 Tagen");
    expect(zuletztBenutztText("2026-11-03T10:00:00Z", JETZT)).toBe("vor 5 Tagen");
    expect(zuletztBenutztText("2026-10-10T10:00:00Z", JETZT)).toBe("vor 29 Tagen");
    expect(zuletztBenutztText("2026-10-09T10:00:00Z", JETZT)).toBe("am 09.10.2026");
  });

  it("Sortierung: zuletzt benutzt zuerst, nie benutzt am Ende, dann Name", () => {
    const k = (name: string, zuletzt: string | null) => ({ name, zuletztBenutztAm: zuletzt }) as ApiSchluesselAnsicht;
    const liste = [k("Birne", null), k("Alt", "2026-10-01T00:00:00Z"), k("Neu", "2026-11-01T00:00:00Z"), k("Äpfel", null)];
    expect(liste.sort(apiSchluesselSortieren).map((x) => x.name)).toEqual(["Neu", "Alt", "Äpfel", "Birne"]);
  });
});

describe("Firmen", () => {
  const aus = { enabled: true, signatureEnabled: false, angebotAusKalkulation: false, tagespreiseEnabled: false };

  it("portalSchalterPatch", () => {
    expect(portalSchalterPatch(aus, "signatureEnabled", true)).toEqual({ signatureEnabled: true });
    expect(portalSchalterPatch({ ...aus, signatureEnabled: true }, "signatureEnabled", false)).toEqual({ signatureEnabled: false });
    expect(portalSchalterPatch(aus, "angebotAusKalkulation", true)).toEqual({ angebotAusKalkulation: true });
    expect(portalSchalterPatch(aus, "tagespreiseEnabled", true)).toBeNull();
    expect(portalSchalterPatch({ ...aus, angebotAusKalkulation: true }, "tagespreiseEnabled", true)).toEqual({ tagespreiseEnabled: true });
    expect(portalSchalterPatch({ ...aus, angebotAusKalkulation: true, tagespreiseEnabled: true }, "angebotAusKalkulation", false)).toEqual({
      angebotAusKalkulation: false,
      tagespreiseEnabled: false,
    });
    expect(portalSchalterPatch({ ...aus, angebotAusKalkulation: true }, "angebotAusKalkulation", false)).toEqual({ angebotAusKalkulation: false });
    expect(portalSchalterPatch({ ...aus, angebotAusKalkulation: true, tagespreiseEnabled: true }, "tagespreiseEnabled", false)).toEqual({
      tagespreiseEnabled: false,
    });
  });

  it("hebelUmschalten hält die Reihenfolge, ohne Doppel", () => {
    expect(hebelUmschalten(["kueche"], "halteverbot", true)).toEqual(["halteverbot", "kueche"]);
    expect(hebelUmschalten(["montage"], "montage", true)).toEqual(["montage"]);
    expect(hebelUmschalten(["montage", "kueche"], "montage", false)).toEqual(["kueche"]);
    expect(hebelUmschalten(["kueche"], "einpacken", false)).toEqual(["kueche"]);
  });

  it("neueZeitpostenId füllt Lücken", () => {
    const z = (id: string) => ({ id, bezeichnung: "x", minuten: 1 });
    expect(neueZeitpostenId([])).toBe("zp-1");
    expect(neueZeitpostenId([z("zp-1"), z("zp-3")])).toBe("zp-2");
    expect(neueZeitpostenId([z("alt-7"), z("zp-1")])).toBe("zp-2");
  });

  it("zahlungsregelText", () => {
    const r = ZAHLUNGSREGEL_STANDARD;
    expect(zahlungsregelText(r)).toBe("Rest fällig am Umzugstag. Erinnerungen aus.");
    expect(zahlungsregelText({ ...r, basis: "rechnungstag" })).toBe("Fällig am Rechnungstag. Erinnerungen aus.");
    expect(zahlungsregelText({ ...r, tage: 1 })).toBe("Fällig 1 Tag nach dem Umzugstag. Erinnerungen aus.");
    expect(zahlungsregelText({ ...r, basis: "rechnungstag", tage: 14, erinnerungModus: "entwurf" })).toBe(
      "Fällig 14 Tage nach dem Rechnungstag. Erinnerung als Entwurf 7 Tage nach Fälligkeit, zweite 14 Tage danach.",
    );
  });
});

describe("Übersicht", () => {
  it("monateBis über den Jahreswechsel", () => {
    const m = monateBis("2026-11-08");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2025-12");
    expect(m[11]).toBe("2026-11");
    expect(monateBis("2026-02-15", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monateBis("2026-02-15", 1)).toEqual(["2026-02"]);
  });

  it("zuflussJeMonat: Kaution nie, Gegenbuchung negativ, Firma, Monat außerhalb", () => {
    const monate = ["2026-10", "2026-11"];
    const zeilen = [
      { tag: "2026-10-05", cent: 10000, taxTreatment: "regulaer", firmaId: "a" },
      { tag: "2026-10-06", cent: 50000, taxTreatment: "nicht_steuerbar", firmaId: "a" },
      { tag: "2026-10-07", cent: -2500, taxTreatment: "regulaer", firmaId: "a" },
      { tag: "2026-11-01", cent: 3000, taxTreatment: null, firmaId: "b" },
      { tag: "2026-11-02", cent: 700, taxTreatment: null, firmaId: null },
      { tag: "2026-09-30", cent: 99999, taxTreatment: null, firmaId: "a" },
    ];
    expect(zuflussJeMonat(zeilen, monate, null)).toEqual({ "2026-10": 7500, "2026-11": 3700 });
    expect(zuflussJeMonat(zeilen, monate, "a")).toEqual({ "2026-10": 7500, "2026-11": 0 });
    expect(zuflussJeMonat([], monate, null)).toEqual({ "2026-10": 0, "2026-11": 0 });
  });

  it("durchfuehrungsTag", () => {
    expect(durchfuehrungsTag({ kategorie: "paid", moveCompletedAt: "2026-10-31T23:30:00Z", moveDate: null })).toBe("2026-11-01");
    expect(durchfuehrungsTag({ kategorie: "done_unpaid", moveCompletedAt: null, moveDate: "2026-10-15" })).toBe("2026-10-15");
    expect(durchfuehrungsTag({ kategorie: "done_unpaid", moveCompletedAt: null, moveDate: "2026-10-15T08:00:00Z" })).toBe("2026-10-15");
    expect(durchfuehrungsTag({ kategorie: "booked", moveCompletedAt: "2026-10-01T10:00:00Z", moveDate: "2026-10-01" })).toBeNull();
    expect(durchfuehrungsTag({ kategorie: null, moveCompletedAt: null, moveDate: "2026-10-01" })).toBeNull();
    expect(durchfuehrungsTag({ kategorie: "paid", moveCompletedAt: null, moveDate: "irgendwann" })).toBeNull();
  });

  const deal = (o: Partial<UebersichtDeal>): UebersichtDeal => ({
    id: Math.random().toString(36),
    angelegtTag: "2026-10-03",
    kategorie: "open_new",
    nichtLead: false,
    firmaId: "a",
    quelle: null,
    durchgefuehrtTag: null,
    auftragCent: null,
    ...o,
  });
  const MONATE = ["2026-10", "2026-11"];

  it("durchgefuehrtJeMonat mit ohne Betrag, Nicht-Lead, kein_lead, Firma, außerhalb", () => {
    const deals = [
      deal({ kategorie: "paid", durchgefuehrtTag: "2026-10-10", auftragCent: 100000 }),
      deal({ kategorie: "done_unpaid", durchgefuehrtTag: "2026-10-11", auftragCent: null }),
      deal({ kategorie: "paid", durchgefuehrtTag: "2026-10-12", auftragCent: 5000, nichtLead: true }),
      deal({ kategorie: "kein_lead", durchgefuehrtTag: "2026-10-12", auftragCent: 5000 }),
      deal({ kategorie: "paid", durchgefuehrtTag: "2026-11-01", auftragCent: 2000, firmaId: "b" }),
      deal({ kategorie: "paid", durchgefuehrtTag: "2026-09-01", auftragCent: 2000 }),
    ];
    expect(durchgefuehrtJeMonat(deals, MONATE, null)).toEqual({
      "2026-10": { cent: 100000, anzahl: 2, ohneBetrag: 1 },
      "2026-11": { cent: 2000, anzahl: 1, ohneBetrag: 0 },
    });
    expect(durchgefuehrtJeMonat(deals, MONATE, "a")["2026-11"]).toEqual({ cent: 0, anzahl: 0, ohneBetrag: 0 });
  });

  it("anfragenJeMonat: Häufigkeit, Gleichstand nach Label, ohne Quelle zuletzt, Nicht-Lead zählt nicht", () => {
    const web = { id: "web", label: "Website" };
    const tel = { id: "tel", label: "Telefon" };
    const app = { id: "app", label: "App" };
    const deals = [
      deal({ quelle: web }),
      deal({ quelle: web, angelegtTag: "2026-11-02" }),
      deal({ quelle: tel }),
      deal({ quelle: app }),
      deal({ quelle: null }),
      deal({ quelle: null }),
      deal({ quelle: null }),
      deal({ quelle: tel, nichtLead: true }),
      deal({ quelle: tel, angelegtTag: "2026-08-01" }),
    ];
    const r = anfragenJeMonat(deals, MONATE, null);
    expect(r.quellen.map((q) => q.id)).toEqual(["web", "app", "tel", OHNE_QUELLE]);
    expect(r.gesamt).toEqual({ "2026-10": 6, "2026-11": 1 });
    expect(r.je["2026-10"]).toEqual({ web: 1, tel: 1, app: 1, [OHNE_QUELLE]: 3 });
  });

  it("abschlussJeMonat: null ohne Entscheidung, Rundung, Kategorie null und kein_lead zählen nicht", () => {
    const deals = [
      deal({ kategorie: "booked" }),
      deal({ kategorie: "paid" }),
      deal({ kategorie: "lost" }),
      deal({ kategorie: "quoted" }),
      deal({ kategorie: null }),
      deal({ kategorie: "kein_lead" }),
      deal({ kategorie: "open_new", angelegtTag: "2026-11-01" }),
    ];
    const r = abschlussJeMonat(deals, MONATE, null);
    expect(r.je["2026-10"]).toEqual({ gewonnen: 2, verloren: 1, offen: 1, quoteProzent: 67 });
    expect(r.je["2026-11"]).toEqual({ gewonnen: 0, verloren: 0, offen: 1, quoteProzent: null });
    expect(r.gesamt).toEqual({ gewonnen: 2, verloren: 1, offen: 2, quoteProzent: 67 });
  });
});

describe("Rechner-Stammdaten", () => {
  const tarif = (o: Record<string, unknown> = {}) => ({
    id: "t1",
    version: 1,
    marke: null,
    aktiv: true,
    stundensatzIntern: "30",
    stundensatzVerkauf: "59.50",
    fahrzeugpauschaleVerkaufProTag: 100,
    kmSatzVerkauf: "1.1",
    rundungEur: 10,
    halteverbotVerkauf: 150,
    entsorgungProCbmVerkauf: 40,
    material: [
      { key: "k", bezeichnung: "Karton", einheit: "stueck", satz: "2.5" },
      { key: "x", bezeichnung: "Unbekannt", einheit: "kg", satz: 1 },
    ],
    margenregeln: [{ geheim: 1 }],
    faktoren: { a: 1 },
    ...o,
  });
  const station = (o: Record<string, unknown> = {}) => ({ id: "s1", name: "Nord", adresse: "Weg 1", aktiv: true, lat: 1, lng: 2, ...o });
  const fahrzeug = (o: Record<string, unknown> = {}) => ({ id: "f1", name: "Sprinter", startortId: "s1", laderaumCbm: "14", ...o });
  const voll = (t: unknown[], s: unknown[], f: unknown[]) => ({ tarife: { tarife: t }, startorte: { startorte: s }, fahrzeuge: { fahrzeuge: f } });

  it("Zahlen als Text, unbekannte Materialeinheit fällt weg", () => {
    const t = tarifAus(tarif())!;
    expect(t.stundensatzVerkauf).toBe(59.5);
    expect(t.kmSatzVerkauf).toBe(1.1);
    expect(t.material).toEqual([{ key: "k", bezeichnung: "Karton", einheit: "stueck", satz: 2.5 }]);
    expect(tarifAus(tarif({ rundungEur: null }))).toBeNull();
  });

  it("eigener aktiver Tarif vor gemeinsamem, inaktive zählen nicht", () => {
    const g = tarifAus(tarif({ id: "g" }))!;
    const k = tarifAus(tarif({ id: "k", marke: "kottke" }))!;
    const kAlt = tarifAus(tarif({ id: "ka", marke: "kottke", aktiv: false }))!;
    expect(aktiverTarifFuer([g, k], "kottke")?.id).toBe("k");
    expect(aktiverTarifFuer([g, k], "ceylan")?.id).toBe("g");
    expect(aktiverTarifFuer([kAlt, g], "kottke")?.id).toBe("g");
    expect(aktiverTarifFuer([kAlt], "kottke")).toBeNull();
  });

  it("fehlende Liste oder unlesbare Zeile: nur Fehler", () => {
    expect(stammdatenAus({ tarife: {}, startorte: { startorte: [] }, fahrzeuge: { fahrzeuge: [] } }, "s").ok).toBe(false);
    expect(stammdatenAus(voll([tarif({ version: null })], [], []), "s").ok).toBe(false);
    expect(stammdatenAus(voll([], [station({ adresse: undefined })], []), "s").ok).toBe(false);
    expect(stammdatenAus(voll([], [station()], [fahrzeug({ laderaumCbm: "viel" })]), "s").ok).toBe(false);
  });

  it("Erfolg: Versionen neueste zuerst, Station am Fahrzeug, Sortierung, keine Rohfelder", () => {
    const r = stammdatenAus(
      voll(
        [tarif({ id: "v1", version: 1, aktiv: false }), tarif({ id: "v3", version: 3, marke: "ceylan" }), tarif({ id: "v2", version: 2 })],
        [station({ id: "s2", name: "Süd" }), station()],
        [
          fahrzeug({ id: "f2", name: "LKW", startortId: "s2", mietpreisWochentage: { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: "7" } }),
          fahrzeug({ mietpreisWochentage: { mo: 1 } }),
        ],
      ),
      "2026-11-08T10:00:00.000Z",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.daten.versionen.map((t) => t.id)).toEqual(["v3", "v2", "v1"]);
    expect(r.daten.tarif.ceylan?.id).toBe("v3");
    expect(r.daten.tarif.kottke?.id).toBe("v2");
    expect(r.daten.stationen.map((s) => s.name)).toEqual(["Nord", "Süd"]);
    expect(r.daten.fahrzeuge.map((f) => [f.name, f.stationName])).toEqual([
      ["LKW", "Süd"],
      ["Sprinter", "Nord"],
    ]);
    expect(r.daten.fahrzeuge[0].mietpreisWochentage?.so).toBe(7);
    expect(r.daten.fahrzeuge[1].mietpreisWochentage).toBeNull();
    const text = JSON.stringify(r);
    for (const f of ["margenregeln", "faktoren", '"lat"', '"lng"']) expect(text).not.toContain(f);
  });
});

describe("Vergleich zum Vormonat im gleichen Zeitraum (M3)", () => {
  it("1. bis zum selben Tag, bei kürzerem Vormonat bis zu dessen Ende, über den Jahreswechsel", async () => {
    const { vormonatGleicherZeitraum } = await import("./einstellungen-uebersicht");
    expect(vormonatGleicherZeitraum("2026-11-09")).toEqual({ von: "2026-10-01", bis: "2026-10-09" });
    expect(vormonatGleicherZeitraum("2026-03-31")).toEqual({ von: "2026-02-01", bis: "2026-02-28" });
    expect(vormonatGleicherZeitraum("2028-03-30")).toEqual({ von: "2028-02-01", bis: "2028-02-29" });
    expect(vormonatGleicherZeitraum("2026-01-15")).toEqual({ von: "2025-12-01", bis: "2025-12-15" });
    expect(vormonatGleicherZeitraum("2026-12-31")).toEqual({ von: "2026-11-01", bis: "2026-11-30" });
  });

  it("zuflussZeitraum zählt beide Grenzen, ohne Kaution, mit Firma", async () => {
    const { zuflussZeitraum } = await import("./einstellungen-uebersicht");
    const zeilen = [
      { tag: "2026-10-01", cent: 100, taxTreatment: null, firmaId: "a" },
      { tag: "2026-10-09", cent: 200, taxTreatment: null, firmaId: "b" },
      { tag: "2026-10-10", cent: 400, taxTreatment: null, firmaId: "a" },
      { tag: "2026-10-05", cent: 800, taxTreatment: "nicht_steuerbar", firmaId: "a" },
      { tag: "2026-10-06", cent: -50, taxTreatment: null, firmaId: "a" },
    ];
    expect(zuflussZeitraum(zeilen, "2026-10-01", "2026-10-09", null)).toBe(250);
    expect(zuflussZeitraum(zeilen, "2026-10-01", "2026-10-09", "a")).toBe(50);
  });
});
