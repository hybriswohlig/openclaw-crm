import { describe, expect, it } from "vitest";
import { preisQuelleAusAnnahme } from "./ab-preise";

const posten = [
  { type: "other", description: "Umzug Kern", quantity: 1, unitRate: 1500, lineTotal: 1500 },
  { type: "other", description: "Halteverbot", quantity: 2, unitRate: 110, lineTotal: 220 },
];

const festpreis = {
  isVariable: false,
  fixedPriceCents: 172000,
  lineItems: posten,
  totalCents: 172000,
  depositRequiredCents: 30000,
};

describe("preisQuelleAusAnnahme", () => {
  it("übernimmt Posten, die zum angenommenen Festpreis passen", () => {
    const q = preisQuelleAusAnnahme(festpreis);
    expect(q?.isVariable).toBe(false);
    expect(q?.fixedPrice).toBe("1720.00");
    expect(q?.lineItems.map((l) => [l.description, l.quantity, Number(l.unitRate)])).toEqual([
      ["Umzug Kern", 1, 1500],
      ["Halteverbot", 2, 110],
    ]);
  });

  it("nimmt bei abweichendem Optionspreis nur den angenommenen Preis ohne Posten", () => {
    const q = preisQuelleAusAnnahme({ ...festpreis, totalCents: 189000 });
    expect(q?.fixedPrice).toBe("1890.00");
    expect(q?.lineItems).toEqual([]);
  });

  it("behält beim Stundensatz die Posten und den Modus", () => {
    const q = preisQuelleAusAnnahme({
      isVariable: true,
      fixedPriceCents: null,
      lineItems: [
        { type: "helper", description: "Helfer", quantity: 3, unitRate: 45, lineTotal: 135 },
        { type: "transporter", description: "Transporter", quantity: 4, unitRate: 30, lineTotal: 120 },
      ],
      totalCents: 25500,
      depositRequiredCents: null,
    });
    expect(q?.isVariable).toBe(true);
    expect(q?.fixedPrice).toBeNull();
    expect(q?.lineItems.map((l) => l.type)).toEqual(["helper", "transporter"]);
  });

  it("liest Zahlen, die als Text gespeichert sind", () => {
    const q = preisQuelleAusAnnahme({
      ...festpreis,
      lineItems: [
        { type: "other", description: "Umzug Kern", quantity: "1", unitRate: "1500.00" },
        { type: "other", description: "Halteverbot", quantity: "2", unitRate: "110" },
      ],
    });
    expect(q?.lineItems).toHaveLength(2);
  });

  it("liefert null beim Stundensatz ohne brauchbare Posten", () => {
    expect(
      preisQuelleAusAnnahme({ isVariable: true, fixedPriceCents: null, lineItems: [{ description: "x" }], totalCents: 25500 })
    ).toBeNull();
  });

  it("liefert null für einen unbrauchbaren Altbestand", () => {
    expect(preisQuelleAusAnnahme(null)).toBeNull();
    expect(preisQuelleAusAnnahme({ totalCents: 1000 })).toBeNull();
    expect(preisQuelleAusAnnahme({ lineItems: [] })).toBeNull();
  });
});
