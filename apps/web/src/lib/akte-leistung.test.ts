import { describe, expect, it } from "vitest";
import { istPortalLeistung, leistungsartVorschlag } from "./kv-vorpruefung";
import { AKTE_LEISTUNGEN, kundeAnsicht, leistungLabel } from "./akte-leistung";

describe("Leistung in der Akte", () => {
  it("bietet alle vier Leistungen an", () => {
    expect(AKTE_LEISTUNGEN.map((l) => l.wert)).toEqual(["move", "clearance_move", "clearance", "kitchen_installation"]);
    expect(AKTE_LEISTUNGEN.every((l) => istPortalLeistung(l.wert))).toBe(true);
    expect(leistungLabel("kitchen_installation")).toBe("Küchenmontage");
    expect(leistungLabel(null)).toBe("Umzug");
  });

  it("Küche und Entrümpelung ohne Einzug, mit eigenen Namen", () => {
    expect(kundeAnsicht("kitchen_installation").felder).not.toContain("einzug");
    expect(kundeAnsicht("kitchen_installation").labels.datum).toBe("Montagetermin");
    expect(kundeAnsicht("clearance").felder).not.toContain("einzug");
    expect(kundeAnsicht("clearance").labels.auszug).toBe("Einsatzort (Kundenanschrift)");
    expect(kundeAnsicht("move").felder).toContain("einzug");
    expect(kundeAnsicht("clearance_move").felder).toContain("einzug");
  });
});

describe("leistungsartVorschlag mit der Wahl aus der Akte", () => {
  const basis = { gespeichert: null, leadType: null };
  it("ohne Angebot gilt die Akte, vor Anfrage und Text", () => {
    expect(leistungsartVorschlag({ ...basis, akte: "kitchen_installation", text: "Umzug von A nach B" })).toBe("kitchen_installation");
    expect(leistungsartVorschlag({ ...basis, leadType: "entruempelung", akte: "move" })).toBe("move");
  });
  it("ein unbestätigter Umzug im Angebot ist nur der Default: die Akte gewinnt", () => {
    expect(leistungsartVorschlag({ gespeichert: "move", leadType: null, akte: "clearance" })).toBe("clearance");
  });
  it("eine Leistung im Angebot gewinnt über die Akte", () => {
    expect(leistungsartVorschlag({ gespeichert: "kitchen_installation", leadType: null, akte: "move" })).toBe("kitchen_installation");
    expect(leistungsartVorschlag({ gespeichert: "move", leadType: null, bestaetigt: true, akte: "clearance" })).toBe("move");
    expect(leistungsartVorschlag({ gespeichert: "move", leadType: null, mitEntruempelung: true, akte: "move" })).toBe("clearance_move");
  });
  it("unbekannte Werte in der Akte zählen nicht", () => {
    expect(leistungsartVorschlag({ ...basis, akte: "transport" })).toBe("move");
    expect(istPortalLeistung("transport")).toBe(false);
  });
});

describe("Kalkulation und Kopfzeile folgen der Akte", () => {
  it("Küchen-Lead ohne Angebot, in der Akte auf Umzug gestellt: Kalkulation rechnet Umzug", async () => {
    const { auftragsartAus } = await import("./auftragsart");
    expect(auftragsartAus({ gespeichert: null, leadType: "Kuechenmontage" })).toBe("kuechenmontage");
    expect(auftragsartAus({ gespeichert: null, leadType: "Kuechenmontage", akte: "move" })).toBe("umzug");
    expect(auftragsartAus({ gespeichert: null, leadType: null, akte: "clearance" })).toBe("entruempelung");
  });
});
