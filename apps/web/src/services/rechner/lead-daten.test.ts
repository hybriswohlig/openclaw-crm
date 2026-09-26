import { describe, expect, it } from "vitest";
import { datumText, inventarAusZeilen, ortText, zahlOderNull } from "./lead-daten-helfer";

describe("ortText", () => {
  it("Straße, PLZ Ort", () => {
    expect(ortText({ line1: "Marktplatz 16", postcode: "71032", city: "Böblingen" })).toBe("Marktplatz 16, 71032 Böblingen");
  });
  it("nur PLZ und Ort ohne Komma (sonst hält der Rechner es für eine volle Adresse)", () => {
    expect(ortText({ postcode: "71032", city: "Böblingen" })).toBe("71032 Böblingen");
    expect(ortText({ city: "Böblingen" })).toBe("Böblingen");
  });
  it("Text bleibt Text, Leeres wird null", () => {
    expect(ortText("innerhalb Böblingen")).toBe("innerhalb Böblingen");
    expect(ortText({})).toBeNull();
    expect(ortText(null)).toBeNull();
    expect(ortText("  ")).toBeNull();
  });
});

describe("inventarAusZeilen", () => {
  it("rechnet das Zeilenvolumen auf je Stück um", () => {
    expect(inventarAusZeilen([{ name: "Kleiderschrank", quantity: 2, sizeClass: "gross", volumeCbmEstimate: "3.6", moveFlag: true }]))
      .toEqual([{ name: "Kleiderschrank", menge: 2, groessenklasse: "gross", volumenCbm: 1.8, mitnehmen: true }]);
  });
  it("ohne Volumen oder Größe: null, bleibt-da wird übernommen (Filter macht die Anfrage)", () => {
    expect(inventarAusZeilen([{ name: "Küche", quantity: 1, sizeClass: null, volumeCbmEstimate: null, moveFlag: false }]))
      .toEqual([{ name: "Küche", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: false }]);
  });
});

describe("datumText und zahlOderNull", () => {
  it("Datum als YYYY-MM-DD, sonst null", () => {
    expect(datumText("2026-10-14")).toBe("2026-10-14");
    expect(datumText("2026-10-14T00:00:00.000Z")).toBe("2026-10-14");
    expect(datumText("demnächst")).toBeNull();
    expect(datumText(null)).toBeNull();
  });
  it("Zahlen aus Zahl oder Text, sonst null", () => {
    expect(zahlOderNull(3)).toBe(3);
    expect(zahlOderNull("70")).toBe(70);
    expect(zahlOderNull("")).toBeNull();
    expect(zahlOderNull("drei")).toBeNull();
  });
});
