import { describe, expect, it } from "vitest";
import { kernBefund } from "@/lib/angebot-wahl";
import { halteverbotVorlaufHinweis, kvBausteine, kvGueltigBis, strasseAus } from "./kv-posten";

// Kalkulation wie bei Lead "Patrick" (2026-09-29): 4 Personen, zwei Halteverbotszonen, drei zerlegte Möbel.
const ergebnis = {
  preis: {
    festpreis: 1730,
    posten: [
      { bezeichnung: "Arbeitsstunden (ohne Küche)", menge: 22.5, einheit: "Std", satz: 35, betrag: 786.38 },
      { bezeichnung: "Fahrzeugpauschale", menge: 1, einheit: "Fahrzeugtag", satz: 210, betrag: 210 },
      { bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 150, betrag: 300 },
    ],
  },
  zeiten: { demontage: 84, montage: 114, packen: 0 },
  team: { groesse: 4 },
  positionen: [
    { name: "Schreibtisch", menge: 1, volumenCbm: 0.7, zerlegt: true },
    { name: "Boxspringbett", menge: 1, volumenCbm: 2, zerlegt: true },
    { name: "Esstisch", menge: 1, volumenCbm: 1, zerlegt: true },
    { name: "Bürostuhl", menge: 1, volumenCbm: 0.15, zerlegt: false },
  ],
};
const anfrage = {
  von_adresse: "Lerchenstraße 78, 70176 Stuttgart",
  nach_adresse: "Friedenstraße 5, 70190 Stuttgart",
  von_halteverbot: "on",
  nach_halteverbot: "on",
};

describe("kvBausteine", () => {
  it("Kern + Hebel: Summe der Posten ist genau der Festpreis", () => {
    const k = kvBausteine({ festpreis: 2260, ergebnis, anfrage });
    expect(k.posten).toEqual([
      { description: "Umzugsteam (4 Personen) & Transporter, inkl. Anfahrt, aller Kilometer, Möbelschutz und Tragewege", quantity: 1, unitRate: 1840 },
      { description: "Demontage & Montage (Boxspringbett, Esstisch und Schreibtisch)", quantity: 1, unitRate: 120 },
      { description: "Halteverbotszone inkl. Beantragung und Schildern (Lerchenstraße 78 und Friedenstraße 5)", quantity: 2, unitRate: 150 },
    ]);
    expect(k.posten.reduce((s, p) => s + p.unitRate * p.quantity, 0)).toBe(2260);
    expect(k.summe).toBe(2260);
    expect(k.leistungen.parkingPickup).toMatchObject({ owner: "company" });
    expect(k.leistungen.parkingDestination?.note).toContain("Friedenstraße 5");
    expect(k.leistungen.dismantling).toEqual({ owner: "company", note: "Boxspringbett, Esstisch und Schreibtisch." });
    expect(k.leistungen.packing).toMatchObject({ owner: "customer" });
  });

  it("ohne Halteverbot: Posten fällt weg, Preis sinkt um genau diesen Betrag, Kunde sorgt für den Parkplatz", () => {
    const k = kvBausteine({ festpreis: 2260, ergebnis, anfrage, optionen: { ohneHalteverbot: true } });
    expect(k.summe).toBe(1960);
    expect(k.abzug).toBe(300);
    expect(k.posten.some((p) => p.description.startsWith("Halteverbot"))).toBe(false);
    expect(k.leistungen.parkingPickup).toMatchObject({ owner: "customer" });
  });

  it("vorgegebener Endpreis bleibt, auch mit ohne Montage", () => {
    const k = kvBausteine({ festpreis: 2100, ergebnis, anfrage, optionen: { ohneMontage: true }, festpreisIstEndpreis: true });
    expect(k.summe).toBe(2100);
    expect(k.abzug).toBe(0);
    expect(k.leistungen.assembly).toMatchObject({ owner: "customer" });
    expect(k.montageDurchUns).toBe(false);
  });

  it("Hebel zu groß im Verhältnis: ein einziger Posten mit allem", () => {
    const k = kvBausteine({ festpreis: 500, ergebnis, anfrage });
    expect(k.posten).toHaveLength(1);
    expect(k.posten[0]!.unitRate).toBe(500);
    expect(k.posten[0]!.description).toContain("Demontage & Montage und Halteverbotszone");
  });

  it("ohne Halteverbot und Montage in der Kalkulation: nur der Kern", () => {
    const k = kvBausteine({ festpreis: 900, ergebnis: { ...ergebnis, positionen: [], zeiten: {} }, anfrage: {} });
    expect(k.posten).toHaveLength(1);
    expect(k.leistungen.parkingPickup).toEqual({ owner: "none" });
    expect(k.leistungen.dismantling).toEqual({ owner: "none" });
  });

  it("expliziter Kunden-Abbau nimmt den Montage-Hebel aus dem Preis", () => {
    const k = kvBausteine({
      festpreis: 2260,
      ergebnis,
      anfrage: {
        ...anfrage,
        positionen_freitext: [
          { name: "Schreibtisch", abbau: "customer", aufbau: "customer" },
          { name: "Boxspringbett", abbau: "customer", aufbau: "customer" },
          { name: "Esstisch", abbau: "customer", aufbau: "customer" },
        ],
      },
    });
    expect(k.posten.some((p) => p.description.startsWith("Demontage"))).toBe(false);
    expect(k.summe).toBe(2140);
    expect(k.abzug).toBe(120);
    expect(k.leistungen.dismantling).toEqual({ owner: "customer", note: "Den Abbau übernehmen Sie selbst." });
    expect(k.leistungen.assembly).toEqual({ owner: "customer", note: "Den Aufbau übernehmen Sie selbst." });
    expect(k.montageDurchUns).toBe(false);
  });

  it("mit montage_je_position: Kunden-Abbau zieht nichts mehr ab, Summe bleibt der Festpreis (Rechner hat die Minuten schon weggelassen)", () => {
    const k = kvBausteine({
      festpreis: 2260,
      ergebnis,
      anfrage: {
        ...anfrage,
        montage_je_position: "1",
        positionen_freitext: [{ name: "Schreibtisch", abbau: "customer", aufbau: "customer" }],
      },
    });
    expect(k.abzug).toBe(0);
    expect(k.summe).toBe(2260);
    expect(k.posten.reduce((s, p) => s + p.unitRate * p.quantity, 0)).toBe(2260);
    expect(k.posten.find((p) => p.description.startsWith("Demontage"))?.description).toBe("Demontage & Montage (Boxspringbett und Esstisch)");
  });

  it("explizite Firmen-Namen ersetzen die Montage-Liste, ohne einen Preis zu erfinden", () => {
    const mitZeit = kvBausteine({
      festpreis: 2260,
      ergebnis,
      anfrage: {
        ...anfrage,
        positionen_freitext: [{ name: "Kleiderschrank", abbau: "company", aufbau: "company" }],
      },
    });
    expect(mitZeit.posten.find((p) => p.description.startsWith("Demontage"))?.description).toBe(
      "Demontage & Montage (Kleiderschrank)"
    );
    expect(mitZeit.leistungen.dismantling).toEqual({ owner: "company", note: "Kleiderschrank." });
    expect(mitZeit.summe).toBe(2260);

    const ohneZeit = kvBausteine({
      festpreis: 900,
      ergebnis: { ...ergebnis, positionen: [], zeiten: {} },
      anfrage: { positionen_freitext: [{ name: "Schrank", abbau: "company", aufbau: "none" }] },
    });
    expect(ohneZeit.posten).toHaveLength(1);
    expect(ohneZeit.summe).toBe(900);
    expect(ohneZeit.leistungen.dismantling).toEqual({ owner: "company", note: "Schrank." });
    expect(ohneZeit.leistungen.assembly).toEqual({ owner: "none" });
  });

  it("Montagezeile nennt nur die Seite der Firma (Entscheidung 12)", () => {
    const text = (abbau: string, aufbau: string) =>
      kvBausteine({
        festpreis: 2260,
        ergebnis,
        anfrage: { ...anfrage, positionen_freitext: [{ name: "Kleiderschrank", abbau, aufbau }] },
      }).posten.find((p) => /Montage|Demontage/.test(p.description) && !p.description.startsWith("Umzugsteam"))?.description;
    expect(text("company", "customer")).toBe("Demontage (Kleiderschrank)");
    expect(text("customer", "company")).toBe("Montage (Kleiderschrank)");
    expect(text("company", "company")).toBe("Demontage & Montage (Kleiderschrank)");
    // ohne Angaben je Position bleibt es bei beiden Seiten
    expect(kvBausteine({ festpreis: 2260, ergebnis, anfrage }).posten[1]!.description).toContain("Demontage & Montage (");
  });

  it("Einpackservice als Hebel, wenn Kartons und Packzeit da sind", () => {
    const k = kvBausteine({ festpreis: 2500, ergebnis: { ...ergebnis, zeiten: { ...ergebnis.zeiten, packen: 300 } }, anfrage: { ...anfrage, einpack_kartons: "40" } });
    expect(k.posten.find((p) => p.description === "Einpackservice (40 Kartons)")?.unitRate).toBe(180);
    expect(k.leistungen.packing).toMatchObject({ owner: "company" });
  });
});

describe("kvGueltigBis", () => {
  it("7 Tage, wenn der Umzug weit weg ist", () => {
    expect(kvGueltigBis("2026-09-29", "2026-11-27")).toEqual({ datum: "2026-10-06", hinweis: null });
  });
  it("Umzug in 3 Tagen: bis zum Vortag", () => {
    expect(kvGueltigBis("2026-09-29", "2026-10-02").datum).toBe("2026-10-01");
  });
  it("Umzug morgen: nur heute", () => {
    expect(kvGueltigBis("2026-09-29", "2026-09-30").datum).toBe("2026-09-29");
  });
  it("ohne Datum 7 Tage, Datum in der Vergangenheit mit Hinweis", () => {
    expect(kvGueltigBis("2026-09-29", null).datum).toBe("2026-10-06");
    expect(kvGueltigBis("2026-09-29", "2026-09-01").hinweis).toContain("Vergangenheit");
  });
  it("Monatswechsel und Schaltjahr", () => {
    expect(kvGueltigBis("2028-02-25", null).datum).toBe("2028-03-03");
  });
});

describe("Hilfen", () => {
  it("Halteverbot-Vorlauf nur bei unter 14 Tagen und mindestens einer Zone", () => {
    expect(halteverbotVorlaufHinweis("2026-09-29", "2026-10-05", 2)).toContain("6 Tagen");
    expect(halteverbotVorlaufHinweis("2026-09-29", "2026-11-27", 2)).toBeNull();
    expect(halteverbotVorlaufHinweis("2026-09-29", "2026-10-05", 0)).toBeNull();
  });
  it("Straße aus der Adresse", () => {
    expect(strasseAus("Lerchenstraße 78, 70176 Stuttgart")).toBe("Lerchenstraße 78");
    expect(strasseAus(null)).toBeNull();
  });
});

describe("kvBausteine: Cent-genau und ohne unsinnige Sätze (Review Codex 2026-10-08)", () => {
  const summe = (posten: Array<{ unitRate: number; quantity: number }>) =>
    posten.reduce((s, p) => s + Math.round(p.unitRate * 100) * p.quantity, 0) / 100;
  it("Sätze mit Bruchteilen von Cent: Posten ergeben trotzdem genau den Festpreis", () => {
    const krumm = {
      ...ergebnis,
      preis: { ...ergebnis.preis, posten: ergebnis.preis.posten.map((p) => (p.bezeichnung === "Halteverbotszone" ? { ...p, satz: 150.005 } : p)) },
    };
    const kv = kvBausteine({ festpreis: 1000, ergebnis: krumm, anfrage });
    expect(summe(kv.posten)).toBe(1000);
    expect(kv.posten.every((p) => Number.isInteger(Math.round(p.unitRate * 100)) && Math.abs(p.unitRate * 100 - Math.round(p.unitRate * 100)) < 1e-9)).toBe(true);
  });
  it("negativer oder leerer Halteverbotssatz: kein eigener Posten, Kern trägt den Festpreis", () => {
    for (const satz of [-150, 0]) {
      const kaputt = {
        ...ergebnis,
        preis: { ...ergebnis.preis, posten: ergebnis.preis.posten.map((p) => (p.bezeichnung === "Halteverbotszone" ? { ...p, satz } : p)) },
      };
      const kv = kvBausteine({ festpreis: 1730, ergebnis: kaputt, anfrage });
      expect(kv.posten.every((p) => p.unitRate > 0)).toBe(true);
      expect(kv.hebel.some((h) => h.art === "halteverbot")).toBe(false);
      expect(summe(kv.posten)).toBe(1730);
    }
  });
});

describe("kvBausteine: Zeilen per Schlüssel (Rechner-Vertrag), Text als Rückfall", () => {
  const montageErgebnis = (posten: Array<Record<string, unknown>>, kostenPosten: Array<Record<string, unknown>> = []) => ({
    preis: { festpreis: 2000, posten: posten as never },
    kosten: { selbstkosten: 1000, posten: kostenPosten as never },
    zeiten: { demontage: 60, montage: 60, packen: 0 },
    team: { groesse: 3 },
    positionen: [{ name: "Schrank", menge: 1, volumenCbm: 2, zerlegt: true }],
  });
  const montageHebel = (k: ReturnType<typeof kvBausteine>) => k.posten.find((p) => p.description.startsWith("Demontage"))!.unitRate;

  it("Arbeitssatz per key verkauf.arbeitsstunden, auch wenn der Text nicht mehr passt", () => {
    const k = kvBausteine({
      festpreis: 2000, anfrage: {},
      ergebnis: montageErgebnis([{ bezeichnung: "Arbeitszeit", key: "verkauf.arbeitsstunden", menge: 10, einheit: "Std", satz: 52, betrag: 520 }]),
    });
    expect(montageHebel(k)).toBe(110); // 2 h × 52 € = 104 → auf 10 aufgerundet
  });

  it("ohne key greift weiter die Text-Regex", () => {
    const mitText = kvBausteine({
      festpreis: 2000, anfrage: {},
      ergebnis: montageErgebnis([{ bezeichnung: "Arbeitsstunden (ohne Küche)", menge: 10, einheit: "Std", satz: 52, betrag: 520 }]),
    });
    expect(montageHebel(mitText)).toBe(110);
    const ohneTreffer = kvBausteine({
      festpreis: 2000, anfrage: {},
      ergebnis: montageErgebnis([{ bezeichnung: "Arbeitszeit", menge: 10, einheit: "Std", satz: 52, betrag: 520 }]),
    });
    expect(montageHebel(ohneTreffer)).toBe(70); // Standard 35 €/h
  });

  it("Halteverbot-Satz (Preis und Kosten) und Personalsatz per key", () => {
    const k = kvBausteine({
      festpreis: 2000,
      anfrage: { von_adresse: "Lerchenstraße 78, 70176 Stuttgart", von_halteverbot: "on" },
      ergebnis: montageErgebnis(
        [{ bezeichnung: "Zone", key: "verkauf.halteverbot", menge: 1, einheit: "Stück", satz: 180, betrag: 180 }],
        [
          { bezeichnung: "Zonenkosten", key: "halteverbot", menge: 1, einheit: "Stück", satz: 90, betrag: 90 },
          { bezeichnung: "Personal Fahrt (Fahrzeit, Puffer)", key: "personal.fahrt", menge: 3, einheit: "Std", satz: 15, betrag: 45 },
          { bezeichnung: "Personal Arbeit (Arbeit, Fahrzeugübergabe, Puffer)", key: "personal.arbeit", menge: 10, einheit: "Std", satz: 20, betrag: 200 },
        ]
      ),
      optionen: { ohneHalteverbot: true, ohneMontage: true },
    });
    expect(k.abzug).toBe(180 + 70);
    // 1 Zone × 90 € + 2 h Montage × 20 €/h (personal.arbeit, nicht die erste Personal-Zeile)
    expect(k.entfalleneKosten).toBe(130);
  });

  it("alter Rechner: eine Zeile personal ohne Teilung wird per key gefunden", () => {
    const k = kvBausteine({
      festpreis: 2000, anfrage: {},
      ergebnis: montageErgebnis([], [{ bezeichnung: "Lohn", key: "personal", menge: 10, einheit: "Std", satz: 25, betrag: 250 }]),
      optionen: { ohneMontage: true },
    });
    expect(k.entfalleneKosten).toBe(50);
  });
});

const inCent = (eur: number) => Math.round(eur * 100);
const postenCent = (posten: Array<{ unitRate: number; quantity: number }>) =>
  posten.reduce((s, p) => s + inCent(p.unitRate) * p.quantity, 0);

describe("kvBausteine: Hebelauswahl und Zusammenklappen (Plan 5b)", () => {
  it("lässt ohne die neuen Optionen den kleinen Kern zusammengeklappt", () => {
    const k = kvBausteine({ festpreis: 500, ergebnis, anfrage, zusammenklappen: "kern_min" });
    expect(k.posten).toHaveLength(1);
    expect(k.posten[0]!.unitRate).toBe(500);
    expect(k.posten[0]!.description).toContain("Demontage & Montage und Halteverbotszone");
  });

  it("hält einen kleinen Kern mit zusammenklappen nie als eigenen Posten", () => {
    const k = kvBausteine({ festpreis: 500, ergebnis, anfrage, festpreisIstEndpreis: true, zusammenklappen: "nie" });
    expect(k.posten.map((p) => p.unitRate)).toEqual([80, 120, 150]);
    expect(k.posten[2]!.quantity).toBe(2);
    expect(postenCent(k.posten)).toBe(inCent(500));
    expect(k.kern).toBe(80);
  });

  it("Basis ohne Hebel: ein Kernposten, nichts daneben", () => {
    const k = kvBausteine({ festpreis: 1840, ergebnis, anfrage, festpreisIstEndpreis: true, hebelNur: [] });
    expect(k.posten).toHaveLength(1);
    expect(k.posten[0]!.description.startsWith("Umzugsteam")).toBe(true);
    expect(k.posten[0]!.description).not.toMatch(/Demontage|Halteverbot|Einpack|Küche/);
    expect(k.hebel).toEqual([]);
    expect(postenCent(k.posten)).toBe(inCent(1840));
  });

  it("nimmt nur die genannten Hebel als eigene Posten, der Rest bleibt im Kern", () => {
    const k = kvBausteine({
      festpreis: 2260,
      ergebnis,
      anfrage,
      festpreisIstEndpreis: true,
      hebelNur: ["halteverbot"],
    });
    expect(k.hebel.map((h) => h.art)).toEqual(["halteverbot"]);
    expect(k.posten.some((p) => p.description.startsWith("Demontage"))).toBe(false);
    expect(postenCent(k.posten)).toBe(inCent(2260));
  });

  it("gibt einen Kern von 0 oder darunter nicht als Posten aus und kernBefund meldet negativ", () => {
    const k = kvBausteine({ festpreis: 100, ergebnis, anfrage, festpreisIstEndpreis: true, zusammenklappen: "nie" });
    expect(k.kern).toBeLessThanOrEqual(0);
    expect(k.posten.every((p) => p.unitRate > 0)).toBe(true);
    expect(k.posten.length).toBeGreaterThan(1);
    expect(
      kernBefund([{ description: "Kern", quantity: 1, unitRate: k.kern }, ...k.posten])
    ).toEqual({ art: "negativ" });
  });

  it("gleicht einen krummen Hebel-Satz auf den Cent aus und klappt nicht zusammen", () => {
    const krumm = {
      ...ergebnis,
      preis: {
        ...ergebnis.preis,
        posten: ergebnis.preis.posten.map((p) => (p.bezeichnung === "Halteverbotszone" ? { ...p, satz: 150.005 } : p)),
      },
    };
    const k = kvBausteine({ festpreis: 500, ergebnis: krumm, anfrage, festpreisIstEndpreis: true, zusammenklappen: "nie" });
    expect(k.posten.length).toBeGreaterThan(1);
    expect(k.posten[0]!.unitRate).toBeLessThan(200);
    expect(k.posten.every((p) => p.unitRate > 0)).toBe(true);
    expect(postenCent(k.posten)).toBe(inCent(500));
  });
});

describe("kvBausteine Küche per Schlüssel", () => {
  it("findet die Küchenzeile über verkauf.kueche, auch mit anderer Bezeichnung", () => {
    const mitKueche = {
      ...ergebnis,
      preis: {
        ...ergebnis.preis,
        posten: [...ergebnis.preis.posten, { key: "verkauf.kueche", bezeichnung: "Küche", menge: 3, einheit: "m", satz: null, betrag: 420 }],
      },
    };
    const k = kvBausteine({ festpreis: 2300, ergebnis: mitKueche, anfrage });
    expect(k.hebel.map((h) => h.art)).toContain("kueche");
  });
});

describe("strasseAus (Plan 15, Review I1)", () => {
  it("nur die Straße, nie PLZ und Ort allein (Chat-Angabe)", () => {
    expect(strasseAus("Hauptstr. 5, 70372 Stuttgart")).toBe("Hauptstr. 5");
    expect(strasseAus("70372 Stuttgart")).toBeNull();
    expect(strasseAus("07031")).toBeNull();
  });
});

describe("kvBausteine: zerlegte Möbel im KV-Text", () => {
  // Fall Viktoria (10.11.): sieben zerlegte Möbel, der KV nannte nur drei und versteckte Betten und Schränke.
  const namen = [
    ["Esstisch dunkel ausziehbar", 20, 25],
    ["Kinderhochbett mit Spielzelt", 45, 60],
    ["Schreibtisch weiß mit Schubladencontainer", 20, 25],
    ["Doppelbett mit Polsterkopfteil", 30, 45],
    ["Kleiderschrank 3-türig mit Spiegel", 60, 90],
    ["Outdoor-Ecksofa Lounge", 30, 30],
    ["Schwebetürenschrank weiß", 70, 100],
  ] as const;
  const ergebnis = {
    preis: { festpreis: 1540, posten: [] },
    zeiten: { demontage: 330, montage: 450 },
    positionen: namen.map(([name], i) => ({ name, menge: 1, volumenCbm: 1, zerlegt: true, positionId: `p${i}` })),
    positionenDetails: namen.map(([, de, mo], i) => ({
      positionId: `p${i}`, katalogKey: null, katalogTreffer: true, groessenklasse: "gross" as const,
      mindestTraeger: 2, trageMin: 10, demontageMin: de, montageMin: mo,
    })),
  };
  it("nennt alle sieben, aufwendigste zuerst", () => {
    const k = kvBausteine({ festpreis: 1540, ergebnis: ergebnis as never, anfrage: { montage_je_position: "1" } as never });
    const text = k.posten.find((p) => p.description.startsWith("Demontage"))?.description;
    expect(text).toBe(
      "Demontage & Montage (Schwebetürenschrank weiß, Kleiderschrank 3-türig mit Spiegel, Kinderhochbett mit Spielzelt, Doppelbett mit Polsterkopfteil, Outdoor-Ecksofa Lounge, Esstisch dunkel ausziehbar und Schreibtisch weiß mit Schubladencontainer)"
    );
  });
  it("ab neun Möbeln: sieben mit Namen und „weitere“", () => {
    const mehr = {
      ...ergebnis,
      positionen: [...ergebnis.positionen, { name: "Regal A", menge: 1, volumenCbm: 0.2, zerlegt: true, positionId: "x1" }, { name: "Regal B", menge: 1, volumenCbm: 0.1, zerlegt: true, positionId: "x2" }],
    };
    const k = kvBausteine({ festpreis: 1540, ergebnis: mehr as never, anfrage: { montage_je_position: "1" } as never });
    const text = k.posten.find((p) => p.description.startsWith("Demontage"))?.description ?? "";
    expect(text.startsWith("Demontage & Montage (Schwebetürenschrank weiß, Kleiderschrank")).toBe(true);
    expect(text.endsWith("und 2 weitere Möbel)")).toBe(true);
  });
});

describe("kvBausteine: Wahl je Möbel und Katalogregel zusammen (KV-Meldung 10.11., Punkt 4)", () => {
  const mit = (zeilen: Array<Record<string, unknown>>, pos = ergebnis.positionen) =>
    kvBausteine({ festpreis: 2260, ergebnis: { ...ergebnis, positionen: pos }, anfrage: { ...anfrage, montage_je_position: "1", positionen_freitext: zeilen } });

  it("nach Regel zerlegte Möbel bleiben in Posten und Leistungen, wenn andere eine Wahl tragen", () => {
    const k = mit([{ name: "Schreibtisch", abbau: "customer", aufbau: "customer" }, { name: "Boxspringbett", abbau: "company", aufbau: "company" }]);
    expect(k.posten.find((p) => p.description.startsWith("Demontage"))?.description).toBe("Demontage & Montage (Boxspringbett und Esstisch)");
    expect(k.leistungen.dismantling).toEqual({ owner: "company", note: "Boxspringbett und Esstisch." });
    expect(k.leistungen.assembly).toEqual({ owner: "company", note: "Boxspringbett und Esstisch." });
    expect(k.montageMoebel).toEqual(["Boxspringbett", "Esstisch"]);
  });

  it("„nicht nötig“ (beides none, Rechner zerlegt nicht) und „nur Kunde“ nennt der KV nicht", () => {
    const pos = ergebnis.positionen.map((p) => (p.name === "Esstisch" ? { ...p, zerlegt: false } : p));
    const k = mit(
      [
        { name: "Esstisch", abbau: "none", aufbau: "none", demontage: "nein" },
        { name: "Schreibtisch", abbau: "customer", aufbau: "customer" },
      ],
      pos
    );
    expect(k.posten.find((p) => p.description.startsWith("Demontage"))?.description).toBe("Demontage & Montage (Boxspringbett)");
    expect(k.leistungen.dismantling).toEqual({ owner: "company", note: "Boxspringbett." });
  });

  it("nur eine Seite bei uns: Titel und Leistung nennen nur diese Seite und nur diese Möbel", () => {
    const pos = ergebnis.positionen.map((p) => ({ ...p, zerlegt: p.name === "Boxspringbett" || p.name === "Schreibtisch" }));
    const k = mit(
      [
        { name: "Boxspringbett", abbau: "company", aufbau: "customer" },
        { name: "Schreibtisch", abbau: "customer", aufbau: "customer" },
      ],
      pos
    );
    expect(k.posten.find((p) => /Demontage|Montage/.test(p.description) && !p.description.startsWith("Umzugsteam"))?.description).toBe("Demontage (Boxspringbett)");
    expect(k.leistungen.dismantling).toEqual({ owner: "company", note: "Boxspringbett." });
    expect(k.leistungen.assembly).toEqual({ owner: "customer", note: "Den Aufbau übernehmen Sie selbst." });
  });

  it("alle beim Kunden: kein Montageposten, Leistungen beim Kunden", () => {
    const k = mit(ergebnis.positionen.filter((p) => p.zerlegt).map((p) => ({ name: p.name, abbau: "customer", aufbau: "customer" })));
    expect(k.posten.some((p) => p.description.startsWith("Demontage"))).toBe(false);
    expect(k.leistungen.dismantling).toEqual({ owner: "customer", note: "Den Abbau übernehmen Sie selbst." });
  });
});

describe("kvBausteine: Review 10.11. (Schreibweise, einseitige Möbel)", () => {
  const mit = (zeilen: Array<Record<string, unknown>>, pos = ergebnis.positionen) =>
    kvBausteine({ festpreis: 2260, ergebnis: { ...ergebnis, positionen: pos }, anfrage: { ...anfrage, montage_je_position: "1", positionen_freitext: zeilen } });

  it("Wahl gilt auch bei anderer Schreibweise des Namens", () => {
    const k = mit([{ name: "schreibtisch ", abbau: "customer", aufbau: "customer" }]);
    expect(k.posten.find((p) => p.description.startsWith("Demontage"))?.description).toBe("Demontage & Montage (Boxspringbett und Esstisch)");
  });

  it("ein Möbel nur Abbau, andere beide Seiten: Posten nennt die Seiten getrennt", () => {
    const k = mit([{ name: "Schreibtisch", abbau: "company", aufbau: "customer" }]);
    expect(k.posten.find((p) => p.description.startsWith("Demontage"))?.description).toBe("Demontage & Montage (Boxspringbett und Esstisch), Demontage (Schreibtisch)");
    expect(k.leistungen.dismantling).toEqual({ owner: "company", note: "Boxspringbett, Esstisch und Schreibtisch." });
    expect(k.leistungen.assembly).toEqual({ owner: "company", note: "Boxspringbett und Esstisch." });
  });
});

describe("kvBausteine: abgewählte Montage (Review I2)", () => {
  const wahl = { montage_je_position: "1", positionen_freitext: [{ name: "Boxspringbett", abbau: "company", aufbau: "company" }] };
  const kunde = { dismantling: { owner: "customer", note: "Den Abbau übernehmen Sie selbst." }, assembly: { owner: "customer", note: "Den Aufbau übernehmen Sie selbst." } };

  it("Hebel ✕ Montage (hebel_aus): kein Montageposten, Leistungen beim Kunden, auch mit Wahl „wir“", () => {
    const k = kvBausteine({ festpreis: 2260, ergebnis: { ...ergebnis, zeiten: { packen: 0 } }, anfrage: { ...anfrage, ...wahl, hebel_aus: '["montage"]' } });
    expect(k.posten.some((p) => /Montage/.test(p.description) && !p.description.startsWith("Umzugsteam"))).toBe(false);
    expect(k.leistungen).toMatchObject(kunde);
    expect(k.montageDurchUns).toBe(false);
  });

  it("„ohne Montage“ (Übernahme mit Option): Leistungen beim Kunden, auch mit Wahl „wir“", () => {
    const k = kvBausteine({ festpreis: 2260, ergebnis, anfrage: { ...anfrage, ...wahl }, optionen: { ohneMontage: true } });
    expect(k.leistungen).toMatchObject(kunde);
  });

  it("Paket ohne Montage-Hebel (hebelNur): Leistungen beim Kunden", () => {
    const k = kvBausteine({ festpreis: 2260, ergebnis, anfrage: { ...anfrage, ...wahl }, hebelNur: ["halteverbot"] });
    expect(k.leistungen).toMatchObject(kunde);
    const mit = kvBausteine({ festpreis: 2260, ergebnis, anfrage: { ...anfrage, ...wahl }, hebelNur: ["montage"] });
    expect(mit.leistungen.dismantling.owner).toBe("company");
  });
});
