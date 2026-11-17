import { describe, expect, it } from "vitest";
import { CREW_TASK_KEYS, CrewTask } from "./contract";
import {
  antwortEntscheiden,
  aufgabenAus,
  farbeAus,
  firmaAus,
  initialenAus,
  istVoll,
  jobArtAus,
  konflikteAmTag,
  lohnSchaetzung,
  meinStatus,
  round5,
  sichtbarkeit,
  istFix,
  tagPlus,
  telefonE164,
  vornameAus,
  type AufgabenEingabe,
  type SichtEingabe,
} from "./logik";

describe("Lohnschätzung", () => {
  it("rundet auf 5 € (500 Cent), halbe Schritte nach oben", () => {
    expect(round5(0)).toBe(0);
    expect(round5(249)).toBe(0);
    expect(round5(250)).toBe(500);
    expect(round5(9_749)).toBe(9_500);
    expect(round5(9_750)).toBe(10_000);
    expect(round5(12_345.6)).toBe(12_500);
  });

  it("Arbeit und Fahrt mit den eigenen Sätzen, Spanne −10 % / +25 %", () => {
    // 300 min × 20 €/h = 100 €, 60 min × 15 €/h = 15 € → 115 € Grundbetrag.
    const p = lohnSchaetzung({ workMinutes: 300, driveMinutes: 60, rateWorkCents: 2000, rateDriveCents: 1500 })!;
    expect(p).toEqual({
      workMinutes: 300,
      driveMinutes: 60,
      rateWorkCents: 2000,
      rateDriveCents: 1500,
      lowCents: 10_500, // 103,50 € → 105 €
      highCents: 14_500, // 143,75 € → 145 €
    });
  });

  it("ohne Fahrt zählt Fahrt als 0, Minuten werden ganzzahlig", () => {
    const p = lohnSchaetzung({ workMinutes: 240.4, driveMinutes: null, rateWorkCents: 1800, rateDriveCents: 1500 })!;
    expect(p.workMinutes).toBe(240);
    expect(p.driveMinutes).toBe(0);
    expect(p.lowCents).toBe(round5(7200 * 0.9));
    expect(p.highCents).toBe(round5(7200 * 1.25));
  });

  it("ohne Arbeitsminuten keine Schätzung (Dauer noch offen)", () => {
    for (const w of [null, 0, -5, Number.NaN]) {
      expect(lohnSchaetzung({ workMinutes: w, driveMinutes: 60, rateWorkCents: 2000, rateDriveCents: 1500 })).toBeNull();
    }
  });
});

describe("Firma", () => {
  it("Kottke und Ceylan/Rümpeltürken, sonst nichts", () => {
    expect(firmaAus("Kottke-Umzüge")).toBe("kottke");
    expect(firmaAus("KOTTKE GmbH")).toBe("kottke");
    expect(firmaAus("Ceylan Operations")).toBe("ruempeltuerken");
    expect(firmaAus("Rümpeltürken")).toBe("ruempeltuerken");
    expect(firmaAus("RÜMPELTÜRKEN")).toBe("ruempeltuerken");
    expect(firmaAus("Ruempeltuerken")).toBe("ruempeltuerken");
    expect(firmaAus("Müller Transporte")).toBeNull();
    expect(firmaAus("")).toBeNull();
    expect(firmaAus(null)).toBeNull();
  });

  it("Art aus KV-Leistung und leadType", () => {
    expect(jobArtAus({ serviceType: "kitchen_installation", leadType: null })).toBe("kitchen");
    expect(jobArtAus({ serviceType: "clearance", leadType: null })).toBe("clearance");
    expect(jobArtAus({ serviceType: null, leadType: "entruempelung" })).toBe("clearance");
    expect(jobArtAus({ serviceType: "move", leadType: null })).toBe("move");
    expect(jobArtAus({ serviceType: null, leadType: null })).toBe("move");
  });
});

const leer: AufgabenEingabe = {
  art: "move",
  etageVon: null,
  etageNach: null,
  zugangVon: null,
  zugangNach: null,
  volumenCbm: null,
  klavier: false,
  abbau: false,
  einpacken: false,
  entsorgung: false,
  einlagerung: false,
  halteverbot: false,
  laufwegVonM: null,
  laufwegNachM: null,
};

describe("Aufgaben-Chips", () => {
  it("ohne Angaben keine Chips", () => {
    expect(aufgabenAus(leer)).toEqual([]);
  });

  it("Umzug: Etagen, Zugang, Volumen, Umfang, Laufweg; alles vertragskonform", () => {
    const t = aufgabenAus({
      ...leer,
      etageVon: 3,
      etageNach: 0,
      zugangVon: "Treppe",
      zugangNach: "Aufzug",
      volumenCbm: 24.25,
      klavier: true,
      abbau: true,
      einpacken: true,
      entsorgung: true,
      einlagerung: true,
      halteverbot: true,
      laufwegVonM: 10,
      laufwegNachM: 35,
    });
    expect(t.map((x) => x.key)).toEqual([
      "floor_from",
      "floor_to",
      "lift",
      "no_lift",
      "volume",
      "piano",
      "dismantling",
      "packing",
      "disposal",
      "storage",
      "halteverbot",
      "long_walk",
    ]);
    expect(t.find((x) => x.key === "floor_from")).toEqual({ key: "floor_from", value: 3, label: "Abholung: 3. OG" });
    expect(t.find((x) => x.key === "floor_to")).toEqual({ key: "floor_to", value: 0, label: "Ziel: EG" });
    expect(t.find((x) => x.key === "volume")).toEqual({ key: "volume", value: 24.3, label: "24,3 m³" });
    expect(t.find((x) => x.key === "long_walk")).toEqual({ key: "long_walk", value: 35, label: "35 m Laufweg" });
    for (const x of t) {
      expect(CrewTask.parse(x)).toEqual(x);
      expect(CREW_TASK_KEYS).toContain(x.key);
      expect(x.label).not.toMatch(/Büro|—/);
    }
  });

  it("kurzer Laufweg ohne Chip; Erdgeschoss ohne Aufzug-Chip", () => {
    const t = aufgabenAus({ ...leer, laufwegVonM: 14, zugangVon: "Erdgeschoss", etageVon: 0 });
    expect(t.map((x) => x.key)).toEqual(["floor_from"]);
    expect(t[0]!.label).toBe("Abholung: EG");
  });

  it("Entrümpelung: kein Ziel, Chip Entrümpelung", () => {
    const t = aufgabenAus({ ...leer, art: "clearance", etageVon: 2, etageNach: 4, zugangNach: "Aufzug", laufwegNachM: 80 });
    expect(t.map((x) => x.key)).toEqual(["floor_from", "clearance_household"]);
    expect(t[0]!.label).toBe("2. OG");
  });

  it("Küche: Abbau wird Küche abbauen, immer Küche aufbauen", () => {
    expect(aufgabenAus({ ...leer, art: "kitchen", abbau: true }).map((x) => x.key)).toEqual(["kitchen_dismantle", "kitchen_assemble"]);
    expect(aufgabenAus({ ...leer, art: "kitchen" }).map((x) => x.key)).toEqual(["kitchen_assemble"]);
  });
});

const heute = "2026-11-16";
const offen: SichtEingabe = {
  geloescht: false,
  stufeKategorie: "booked",
  datum: "2026-11-20",
  heute,
  workerCount: 3,
  ausschreiben: null,
  firma: "kottke",
  meins: false,
};

describe("Sichtbarkeit A/B", () => {
  it("A: gebuchter Job ab heute mit Anzahl, ausgeschrieben, bekannte Firma", () => {
    expect(sichtbarkeit(offen)).toEqual({ a: true, b: false });
    expect(sichtbarkeit({ ...offen, datum: heute }).a).toBe(true);
    expect(sichtbarkeit({ ...offen, ausschreiben: true }).a).toBe(true);
  });

  it("A nicht: andere Stufe, Vergangenheit, ohne Anzahl, ausgeschaltet, fremde Firma, gelöscht, ohne Termin", () => {
    for (const e of [
      { stufeKategorie: "open_new" },
      { stufeKategorie: "lost" },
      { stufeKategorie: "done_unpaid" },
      { stufeKategorie: null },
      { datum: "2026-11-15" },
      { workerCount: null },
      { workerCount: 0 },
      { ausschreiben: false },
      { firma: null },
      { geloescht: true },
      { datum: null },
    ] as Array<Partial<SichtEingabe>>) {
      expect(sichtbarkeit({ ...offen, ...e }).a).toBe(false);
    }
  });

  it("A unsicher: Angebot oder Gespräch ab heute, auch ohne Anzahl; aber nicht ausgeschaltet, vergangen oder fremd", () => {
    for (const k of ["quoted", "open_engaged"]) {
      expect(sichtbarkeit({ ...offen, stufeKategorie: k }).a).toBe(true);
      expect(sichtbarkeit({ ...offen, stufeKategorie: k, workerCount: null }).a).toBe(true);
      expect(sichtbarkeit({ ...offen, stufeKategorie: k, ausschreiben: false }).a).toBe(false);
      expect(sichtbarkeit({ ...offen, stufeKategorie: k, datum: "2026-11-15" }).a).toBe(false);
      expect(sichtbarkeit({ ...offen, stufeKategorie: k, firma: null }).a).toBe(false);
    }
  });

  it("istFix: gebucht oder später fest, sonst nicht", () => {
    for (const k of ["booked", "done_unpaid", "paid"]) expect(istFix(k), k).toBe(true);
    for (const k of ["quoted", "open_engaged", "open_new", "lost", "", null]) expect(istFix(k), String(k)).toBe(false);
  });

  it("B: mein Job ab gestern, auch ohne Anzahl, ausgeschaltet oder andere Stufe", () => {
    const meins = { ...offen, meins: true, workerCount: null, ausschreiben: false, stufeKategorie: "done_unpaid" };
    expect(sichtbarkeit({ ...meins, datum: "2026-11-15" })).toEqual({ a: false, b: true });
    expect(sichtbarkeit({ ...meins, datum: "2026-11-14" }).b).toBe(false);
    expect(sichtbarkeit({ ...meins, meins: false }).b).toBe(false);
  });

  it("B nicht für gelöschte oder verlorene Deals", () => {
    const meins = { ...offen, meins: true };
    expect(sichtbarkeit({ ...meins, geloescht: true })).toEqual({ a: false, b: false });
    expect(sichtbarkeit({ ...meins, stufeKategorie: "lost" }).b).toBe(false);
    expect(sichtbarkeit({ ...meins, stufeKategorie: "kein_lead" }).b).toBe(false);
  });

  it("tagPlus über Monatsgrenzen", () => {
    expect(tagPlus("2026-12-01", -1)).toBe("2026-11-30");
    expect(tagPlus("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("Antwort-Zustandsmaschine", () => {
  it("ja auf freien Job bleibt ja; auf vollen Job wird warteliste", () => {
    expect(antwortEntscheiden({ antwort: "ja", zugeteilt: false, voll: false })).toEqual({ art: "speichern", answer: "ja" });
    expect(antwortEntscheiden({ antwort: "ja", zugeteilt: false, voll: true })).toEqual({ art: "speichern", answer: "warteliste" });
  });

  it("vielleicht und nein werden gespeichert, auch bei vollem Job", () => {
    for (const a of ["vielleicht", "nein"] as const) {
      expect(antwortEntscheiden({ antwort: a, zugeteilt: false, voll: true })).toEqual({ art: "speichern", answer: a });
    }
  });

  it("null nimmt die Antwort zurück", () => {
    expect(antwortEntscheiden({ antwort: null, zugeteilt: false, voll: true })).toEqual({ art: "loeschen" });
  });

  it("eingeteilt: jede Antwort 409 BEREITS_BESTAETIGT, auch null", () => {
    for (const a of ["ja", "vielleicht", "nein", null] as const) {
      expect(antwortEntscheiden({ antwort: a, zugeteilt: true, voll: false })).toEqual({ art: "fehler", code: "BEREITS_BESTAETIGT" });
    }
  });

  it("Status: deal_employees schlägt die Antwort, sonst Antwort, sonst offen", () => {
    expect(meinStatus({ zugeteilt: true, antwort: "nein" })).toBe("bestaetigt");
    expect(meinStatus({ zugeteilt: false, antwort: "warteliste" })).toBe("warteliste");
    expect(meinStatus({ zugeteilt: false, antwort: null })).toBe("offen");
  });

  it("voll erst ab worker_count, ohne Anzahl nie", () => {
    expect(istVoll(2, 3)).toBe(false);
    expect(istVoll(3, 3)).toBe(true);
    expect(istVoll(4, 3)).toBe(true);
    expect(istVoll(5, null)).toBe(false);
  });
});

describe("Konflikt am Tag", () => {
  const job = (id: string, date: string, status: string, dateEnd: string | null = null) =>
    ({ id, date, dateEnd, my: { status, answeredAt: null } }) as never;

  it("anderer Job am selben Tag mit ja oder bestätigt", () => {
    const k = konflikteAmTag([job("a", "2026-11-20", "ja"), job("b", "2026-11-20", "offen"), job("c", "2026-11-21", "offen")]);
    expect(Object.fromEntries(k)).toEqual({ a: false, b: true, c: false });
  });

  it("mehrtägige Jobs überschneiden sich; vielleicht und warteliste zählen nicht", () => {
    const k = konflikteAmTag([
      job("a", "2026-11-20", "bestaetigt", "2026-11-22"),
      job("b", "2026-11-22", "offen"),
      job("c", "2026-11-23", "vielleicht"),
      job("d", "2026-11-23", "warteliste"),
    ]);
    expect(Object.fromEntries(k)).toEqual({ a: false, b: true, c: false, d: false });
  });
});

describe("Person und Telefon", () => {
  it("Vorname, Initialen, stabile Farbe", () => {
    expect(vornameAus("  Mehmet Ali Yilmaz ")).toBe("Mehmet");
    expect(initialenAus("Mehmet Ali Yilmaz")).toBe("MY");
    expect(initialenAus("Ali")).toBe("A");
    expect(farbeAus("e1")).toBe(farbeAus("e1"));
    expect(farbeAus("e1")).toMatch(/^[0-9a-f]{6}$/);
  });

  it("deutsche Nummern werden E.164", () => {
    expect(telefonE164("0151 1234 5678")).toBe("+4915112345678");
    expect(telefonE164("0151/12345678")).toBe("+4915112345678");
    expect(telefonE164("+49 151 12345678")).toBe("+4915112345678");
    expect(telefonE164("+49 (0) 151 12345678")).toBe("+4915112345678");
    expect(telefonE164("+490151 12345678")).toBe("+4915112345678");
    expect(telefonE164("0049 151-12345678")).toBe("+4915112345678");
    expect(telefonE164("0711 123456")).toBe("+49711123456");
  });

  it("andere Länder mit + oder 00", () => {
    expect(telefonE164("+90 532 123 45 67")).toBe("+905321234567");
    expect(telefonE164("0048 600 123 456")).toBe("+48600123456");
  });

  it("Unsinn wird null", () => {
    for (const x of ["", "  ", "abc", "151 12345678", "+0151", "0", "+49 15", null, undefined, "+12345678901234567"]) {
      expect(telefonE164(x)).toBeNull();
    }
  });
});

describe("Stammdaten mit Telefon und Sprache", async () => {
  const { pruefeStammdaten } = await import("@/lib/einsatz");
  it("Telefon muss zu E.164 werden, leer ist erlaubt", () => {
    expect(pruefeStammdaten({ telefon: "0151 1234567" }, false)).toBeNull();
    expect(pruefeStammdaten({ telefon: "" }, false)).toBeNull();
    expect(pruefeStammdaten({ telefon: null }, false)).toBeNull();
    expect(pruefeStammdaten({ telefon: "abc" }, false)).toBe("TELEFON_UNGUELTIG");
  });
  it("Sprache nur aus den sieben", () => {
    expect(pruefeStammdaten({ sprache: "tr" }, false)).toBeNull();
    expect(pruefeStammdaten({ sprache: "fr" }, false)).toBe("SPRACHE_UNGUELTIG");
  });
});

describe("personenZahl", () => {
  it("Zahl oder Text, gerundet, 1 bis 50, sonst null", async () => {
    const { personenZahl } = await import("./logik");
    expect(personenZahl(3)).toBe(3);
    expect(personenZahl("4")).toBe(4);
    expect(personenZahl(2.6)).toBe(3);
    for (const x of [0, -1, 51, "", " ", "x", null, undefined, Number.NaN, {}]) expect(personenZahl(x)).toBeNull();
  });
});
