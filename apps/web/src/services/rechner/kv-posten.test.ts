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
