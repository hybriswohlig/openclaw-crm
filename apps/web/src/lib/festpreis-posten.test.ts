import { describe, expect, it } from "vitest";
import { festpreisAlsPauschale, istBepreist, postenErgebenFestpreis } from "./festpreis-posten";

/** Posten wie nach „In Angebot übernehmen“ (Kern + Hebel, Summe 1720 €) */
const kernUndHebel = [
  { type: "other", quantity: 1, unitRate: "1500.00" },
  { type: "other", quantity: 2, unitRate: "110.00" },
];

const stundensatz = [
  { type: "helper", quantity: 3, unitRate: "45" },
  { type: "transporter", quantity: 4, unitRate: "30" },
];

describe("istBepreist", () => {
  it("zählt nur Posten mit einem Preis über 0", () => {
    expect(istBepreist({ unitRate: "0.01" })).toBe(true);
    expect(istBepreist({ unitRate: "0" })).toBe(false);
    expect(istBepreist({ unitRate: "-10" })).toBe(false);
    expect(istBepreist({ unitRate: "abc" })).toBe(false);
  });
});

describe("postenErgebenFestpreis", () => {
  it("passt, wenn die Posten zusammen den Festpreis ergeben, egal wie er geschrieben ist", () => {
    expect(postenErgebenFestpreis(kernUndHebel, "1720.00")).toBe(true);
    expect(postenErgebenFestpreis(kernUndHebel, "1720")).toBe(true);
  });

  it("passt nicht, sobald ein Cent fehlt oder zu viel ist", () => {
    expect(postenErgebenFestpreis(kernUndHebel, "1800.00")).toBe(false);
    expect(postenErgebenFestpreis(kernUndHebel, "1719.99")).toBe(false);
    expect(postenErgebenFestpreis(kernUndHebel, "1720.01")).toBe(false);
  });

  it("rechnet in Cent, damit Kommazahl-Reste nicht stören", () => {
    // In Euro wäre 0,10 + 0,20 = 0,30000000000000004 und 3 × 1,10 = 3,3000000000000003.
    const zehnUndZwanzig = [
      { quantity: 1, unitRate: "0.10" },
      { quantity: 1, unitRate: "0.20" },
    ];
    expect(postenErgebenFestpreis(zehnUndZwanzig, "0.30")).toBe(true);
    expect(postenErgebenFestpreis([{ quantity: 3, unitRate: "1.10" }], "3.30")).toBe(true);
    expect(postenErgebenFestpreis([{ quantity: 3, unitRate: "33.33" }], "99.99")).toBe(true);
  });

  it("übergeht Posten ohne Preis", () => {
    const posten = [...kernUndHebel, { quantity: 1, unitRate: "0" }, { quantity: 2, unitRate: "-50" }];
    expect(postenErgebenFestpreis(posten, "1720.00")).toBe(true);
  });

  it("ohne bepreiste Posten passt kein Festpreis über 0", () => {
    expect(postenErgebenFestpreis([], "890")).toBe(false);
    expect(postenErgebenFestpreis([{ quantity: 1, unitRate: "0" }], "890")).toBe(false);
  });
});

describe("festpreisAlsPauschale", () => {
  it("Festpreis ohne Posten: eine Zeile „Pauschale“", () => {
    expect(festpreisAlsPauschale({ isVariable: false, fixedPrice: "890", lineItems: [] })).toBe(true);
    expect(
      festpreisAlsPauschale({ isVariable: false, fixedPrice: "890", lineItems: [{ type: "other", quantity: 1, unitRate: "0" }] })
    ).toBe(true);
  });

  it("Festpreis mit passenden Posten: die Posten stehen im KV", () => {
    expect(festpreisAlsPauschale({ isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel })).toBe(false);
  });

  it("Festpreis mit Posten, die ihn nicht ergeben: eine Zeile „Pauschale“", () => {
    expect(festpreisAlsPauschale({ isVariable: false, fixedPrice: "1800.00", lineItems: kernUndHebel })).toBe(true);
  });

  it("ohne Festpreis gibt es keine Pauschale", () => {
    expect(festpreisAlsPauschale({ isVariable: false, fixedPrice: null, lineItems: kernUndHebel })).toBe(false);
    expect(festpreisAlsPauschale({ isVariable: false, fixedPrice: "", lineItems: [] })).toBe(false);
  });

  it("Stundensatz mit Helfern und Transporter: Stundensätze, auch wenn ein Festpreis gespeichert ist", () => {
    expect(festpreisAlsPauschale({ isVariable: true, fixedPrice: "500.00", lineItems: stundensatz })).toBe(false);
  });

  it("variabler Preis ohne Helfer und Transporter: Posten ohne Summenprüfung, sonst Pauschale", () => {
    const klavier = [{ type: "other", quantity: 1, unitRate: "300" }];
    expect(festpreisAlsPauschale({ isVariable: true, fixedPrice: "500.00", lineItems: klavier })).toBe(false);
    expect(festpreisAlsPauschale({ isVariable: true, fixedPrice: "500.00", lineItems: [] })).toBe(true);
  });
});
