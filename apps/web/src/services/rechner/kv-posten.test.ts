import { describe, expect, it } from "vitest";
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
      { description: "Demontage & Montage (Schreibtisch, Boxspringbett und Esstisch)", quantity: 1, unitRate: 120 },
      { description: "Halteverbotszone inkl. Beantragung und Schildern (Lerchenstraße 78 und Friedenstraße 5)", quantity: 2, unitRate: 150 },
    ]);
    expect(k.posten.reduce((s, p) => s + p.unitRate * p.quantity, 0)).toBe(2260);
    expect(k.summe).toBe(2260);
    expect(k.leistungen.parkingPickup).toMatchObject({ owner: "company" });
    expect(k.leistungen.parkingDestination?.note).toContain("Friedenstraße 5");
    expect(k.leistungen.dismantling).toEqual({ owner: "company", note: "Schreibtisch, Boxspringbett und Esstisch." });
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
