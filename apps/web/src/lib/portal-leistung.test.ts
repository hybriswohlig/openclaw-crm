import { describe, expect, it } from "vitest";
import { ausPortalLeistung, leistungAusText, leistungsWorte, portalLeistung } from "@openclaw-crm/customer-portal-core";

describe("portalLeistung", () => {
  it("macht aus Umzug mit Entrümpelung die Kombination", () => {
    expect(portalLeistung("move", true)).toBe("clearance_move");
    expect(portalLeistung("move", false)).toBe("move");
    expect(portalLeistung("move", null)).toBe("move");
  });
  it("ignoriert den Zusatz bei Küche und Entrümpelung", () => {
    expect(portalLeistung("kitchen_installation", true)).toBe("kitchen_installation");
    expect(portalLeistung("clearance", true)).toBe("clearance");
  });
  it("Kombination gilt rechtlich als Umzug", () => {
    expect(ausPortalLeistung("clearance_move")).toEqual({ serviceType: "move", mitEntruempelung: true });
    expect(ausPortalLeistung("kitchen_installation")).toEqual({ serviceType: "kitchen_installation", mitEntruempelung: false });
  });
});

describe("leistungsWorte", () => {
  it("Kottke duzt, andere siezen", () => {
    expect(leistungsWorte("kitchen_installation", "kottke").deinDat).toBe("deiner Küchenmontage");
    expect(leistungsWorte("kitchen_installation", "ceylan").deinDat).toBe("Ihrer Küchenmontage");
    expect(leistungsWorte("move", "kottke").deinNom).toBe("Dein Umzug");
  });
  it("Küche hat einen Montageort statt Abholung und Ziel", () => {
    const w = leistungsWorte("kitchen_installation", "kottke");
    expect(w.adressen).toBe("einsatzort");
    expect(w.termin).toBe("Montagetermin");
    expect(w.checkliste).toBe(false);
    expect(w.standardleistungen).toBe(false);
    expect(leistungsWorte("clearance_move", "kottke").standardleistungen).toBe(true);
  });
  it("ohne Leistung gilt Umzug", () => {
    expect(leistungsWorte(null, "kottke").name).toBe("Umzug");
  });
  it("kein Gedankenstrich in Kundentexten", () => {
    for (const l of ["move", "kitchen_installation", "clearance", "clearance_move"] as const) {
      for (const firma of ["kottke", "ceylan"]) {
        expect(JSON.stringify(leistungsWorte(l, firma))).not.toMatch(/[–—]/);
      }
    }
  });
});

describe("leistungAusText", () => {
  it("erkennt eine reine Küchenmontage", () => {
    expect(leistungAusText("IKEA-Küchenmontage in Stuttgart-Bad Cannstatt (EG)")).toBe("kitchen_installation");
    expect(leistungAusText("Küchenmontage Unterschränke / Küchenzeile")).toBe("kitchen_installation");
  });
  it("Küche abbauen beim Umzug bleibt Umzug", () => {
    expect(leistungAusText("Umzug mit Küchenmontage am Ziel")).toBeNull();
  });
  it("erkennt Entrümpelung und die Kombination", () => {
    expect(leistungAusText("Entrümpelung Keller und Dachboden")).toBe("clearance");
    expect(leistungAusText("Haushaltsauflösung und Umzug der restlichen Möbel")).toBe("clearance_move");
  });
  it("Umzug mit Küche oder verneinter Entrümpelung bleibt ohne Vorschlag", () => {
    expect(leistungAusText("Transport des Hausstands von Stuttgart nach Ulm inklusive Küchenmontage")).toBeNull();
    expect(leistungAusText("Transport von Möbeln, keine Sperrmüllentsorgung")).toBeNull();
    expect(leistungAusText("Umzug ohne Entrümpelung")).toBeNull();
    expect(leistungAusText("IKEA-Küche abbauen und am Ziel aufbauen")).toBeNull();
  });
  it("ohne Hinweis kein Vorschlag", () => {
    expect(leistungAusText("Umzug 3-Zimmer-Wohnung")).toBeNull();
    expect(leistungAusText("")).toBeNull();
  });
});
