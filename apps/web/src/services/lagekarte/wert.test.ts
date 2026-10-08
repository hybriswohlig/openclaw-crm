import { describe, expect, it } from "vitest";
import { angebotSummeCent, bezahltCent, euroZuCent, leadWert, type AngebotRoh } from "./wert";

const a = (p: Partial<AngebotRoh>): AngebotRoh => ({ fixedPriceEuro: null, isVariable: false, selectedPackageOptionId: null, optionen: [], positionen: [], ...p });

describe("euroZuCent", () => {
  it("rechnet Euro-Strings und Zahlen korrekt um", () => {
    expect(euroZuCent("1249.50")).toBe(124950);
    expect(euroZuCent(980)).toBe(98000);
    expect(euroZuCent("0.1")).toBe(10);
    expect(euroZuCent(null)).toBeNull();
    expect(euroZuCent("")).toBeNull();
    expect(euroZuCent("abc")).toBeNull();
  });
});

describe("angebotSummeCent (Portal-Regel)", () => {
  it("Festpreis in Euro wird Cent", () => expect(angebotSummeCent(a({ fixedPriceEuro: "1890.00" }))).toBe(189000));
  it("gebundene Option schlägt Festpreis (Option ist schon Cent)", () => {
    expect(angebotSummeCent(a({ fixedPriceEuro: "1000", selectedPackageOptionId: "o2", optionen: [
      { id: "o1", priceCents: 150000, isRecommended: true, sortOrder: 0 },
      { id: "o2", priceCents: 210000, isRecommended: false, sortOrder: 1 },
    ] }))).toBe(210000);
  });
  it("ohne Auswahl gilt die empfohlene Option", () => {
    expect(angebotSummeCent(a({ optionen: [
      { id: "o1", priceCents: 150000, isRecommended: false, sortOrder: 0 },
      { id: "o2", priceCents: 210000, isRecommended: true, sortOrder: 1 },
    ] }))).toBe(210000);
  });
  it("variabel: Positionen in Euro summiert, Optionen ignoriert", () => {
    expect(angebotSummeCent(a({ isVariable: true, optionen: [{ id: "o1", priceCents: 999, isRecommended: true, sortOrder: 0 }], positionen: [
      { quantity: 3, unitRateEuro: "45.50" },
      { quantity: 1, unitRateEuro: "120" },
    ] }))).toBe(25650);
  });
  it("variabel: Positionssumme rundet je Position auf Cent wie das Portal", () => {
    expect(angebotSummeCent(a({ isVariable: true, positionen: [{ quantity: 3, unitRateEuro: "0.335" }, { quantity: 1, unitRateEuro: "10" }] }))).toBe(1101);
  });
  it("variabel ohne Positionen fällt auf den Festpreis zurück", () => {
    expect(angebotSummeCent(a({ isVariable: true, fixedPriceEuro: "500" }))).toBe(50000);
  });
  it("0 € ist unbekannt", () => expect(angebotSummeCent(a({ fixedPriceEuro: "0" }))).toBeNull());
});

describe("leadWert", () => {
  it("bestätigte Annahme (Cent) zuerst", () => expect(leadWert({ kvaCent: 199000, angebot: a({ fixedPriceEuro: "1" }), dealValue: { amount: 5 }, rechnerErgebnis: null })).toEqual({ cent: 199000, art: "bestaetigt" }));
  it("dann Angebot", () => expect(leadWert({ kvaCent: null, angebot: a({ fixedPriceEuro: "1200" }), dealValue: { amount: 5 }, rechnerErgebnis: null })).toEqual({ cent: 120000, art: "angebot" }));
  it("dann deals.value (Euro-JSON, currency oder currencyCode)", () => {
    expect(leadWert({ kvaCent: null, angebot: null, dealValue: { amount: 850, currency: "EUR" }, rechnerErgebnis: null })).toEqual({ cent: 85000, art: "schaetzung" });
    expect(leadWert({ kvaCent: null, angebot: null, dealValue: { amount: "850", currencyCode: "EUR" }, rechnerErgebnis: null })).toEqual({ cent: 85000, art: "schaetzung" });
  });
  it("dann Rechner-Festpreis (Euro)", () => expect(leadWert({ kvaCent: null, angebot: null, dealValue: null, rechnerErgebnis: { preis: { festpreis: 1430 } } })).toEqual({ cent: 143000, art: "schaetzung" }));
  it("sonst null, nie 0", () => expect(leadWert({ kvaCent: 0, angebot: a({}), dealValue: { amount: 0 }, rechnerErgebnis: {} })).toBeNull());
});

describe("bezahltCent", () => {
  it("summiert Euro, ohne Kaution (nicht_steuerbar)", () => {
    expect(bezahltCent([
      { amountEuro: "500.00", taxTreatment: "betriebseinnahme" },
      { amountEuro: "300", taxTreatment: "nicht_steuerbar" },
      { amountEuro: "120.5", taxTreatment: null },
    ])).toBe(62050);
  });
});
