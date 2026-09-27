import { describe, expect, it } from "vitest";
import { datumText, groesseAusLead, inventarAusZeilen, ortText, zahlOderNull, zimmerZahl } from "./lead-daten-helfer";

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

describe("zimmerZahl", () => {
  it("Spannen und Plus-Angaben aus Portalen: obere Zahl", () => {
    expect(zimmerZahl("1-2")).toBe(2);
    expect(zimmerZahl("2 - 3")).toBe(3);
    expect(zimmerZahl("5+")).toBe(5);
    expect(zimmerZahl("2,5")).toBe(2.5);
    expect(zimmerZahl(3)).toBe(3);
  });
  it("Unbrauchbares wird null", () => {
    expect(zimmerZahl("")).toBeNull();
    expect(zimmerZahl("k. A.")).toBeNull();
    expect(zimmerZahl(0)).toBeNull();
    expect(zimmerZahl("-2")).toBeNull();
    expect(zimmerZahl(null)).toBeNull();
  });
});

describe("groesseAusLead", () => {
  it("Felder am Deal haben Vorrang", () => {
    expect(groesseAusLead({ wohnflaeche_qm: 80, zimmer: 3, moving_lead_payload: { from: { livingSpace: 57, rooms: "1-2" } } }))
      .toEqual({ wohnflaecheQm: 80, zimmer: 3 });
  });
  it("sonst aus dem Portal-Import (moving_lead_payload.from)", () => {
    expect(groesseAusLead({ moving_lead_payload: { from: { livingSpace: 57, rooms: "1-2" } } }))
      .toEqual({ wohnflaecheQm: 57, zimmer: 2 });
    expect(groesseAusLead({ moving_lead_payload: { from: { livingSpace: "57,5", rooms: "" } } }))
      .toEqual({ wohnflaecheQm: 57.5, zimmer: null });
  });
  it("zuletzt aus den Inventar-Notizen des Imports", () => {
    expect(groesseAusLead({ inventory_notes: "Typ: Privatumzug\nWohnfläche: 57 m²\nZimmer: 1-2\nPersonen: 2" }))
      .toEqual({ wohnflaecheQm: 57, zimmer: 2 });
  });
  it("gar nichts: beides null, kein Fehler", () => {
    expect(groesseAusLead({})).toEqual({ wohnflaecheQm: null, zimmer: null });
    expect(groesseAusLead({ moving_lead_payload: "kaputt", inventory_notes: 42 })).toEqual({ wohnflaecheQm: null, zimmer: null });
  });
  it("0 oder negative Werte zählen nicht", () => {
    expect(groesseAusLead({ wohnflaeche_qm: "-57" })).toEqual({ wohnflaecheQm: null, zimmer: null });
    expect(groesseAusLead({ wohnflaeche_qm: 0, moving_lead_payload: { from: { livingSpace: 0 } } }))
      .toEqual({ wohnflaecheQm: null, zimmer: null });
  });
});
