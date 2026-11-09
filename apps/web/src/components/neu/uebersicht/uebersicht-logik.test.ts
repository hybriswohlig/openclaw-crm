import { describe, expect, it } from "vitest";
import { balkenHoehe, euro, monatKurz, monatLang, topQuellen, vergleichText, vieleOffen } from "./uebersicht-logik";

describe("balkenHoehe", () => {
  it("Prozent, 0 bei max 0, negative Werte 0, höchstens 100", () => {
    expect(balkenHoehe(50, 200)).toBe(25);
    expect(balkenHoehe(5, 0)).toBe(0);
    expect(balkenHoehe(-10, 100)).toBe(0);
    expect(balkenHoehe(300, 100)).toBe(100);
  });
});

describe("topQuellen", () => {
  const r = {
    quellen: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "ohne", label: "Ohne Quelle" },
    ],
    je: { "2026-10": { a: 3, b: 2, c: 1, ohne: 4 }, "2026-11": {} },
    gesamt: { "2026-10": 10, "2026-11": 0 },
  };
  it("nimmt die ersten n und summiert den Rest je Monat", () => {
    expect(topQuellen(r, 2)).toEqual({ quellen: [{ id: "a", label: "A" }, { id: "b", label: "B" }], weitere: { "2026-10": 5, "2026-11": 0 } });
    expect(topQuellen(r, 10).weitere).toEqual({ "2026-10": 0, "2026-11": 0 });
  });
});

describe("vergleichText", () => {
  it("Prozent zum Vormonat, gleich, ohne Vormonat leer", () => {
    expect(vergleichText(112, 100)).toBe("+12 % zum Vormonat");
    expect(vergleichText(95, 100)).toBe("−5 % zum Vormonat");
    expect(vergleichText(100, 100)).toBe("wie im Vormonat");
    expect(vergleichText(100, 0)).toBe("");
    expect(vergleichText(50, -100)).toBe("+150 % zum Vormonat");
  });
});

describe("Anzeige", () => {
  it("euro in ganzen Euro, negativ mit Minus", () => {
    expect(euro(123456)).toMatch(/^1\.235\s€$/);
    expect(euro(-5000)).toMatch(/^−50\s€$/);
    expect(euro(0)).toMatch(/^0\s€$/);
  });
  it("Monate", () => {
    expect(monatKurz("2026-11")).toBe("Nov 26");
    expect(monatLang("2025-03")).toBe("März 2025");
  });
  it("viele offen", () => {
    expect(vieleOffen({ gewonnen: 1, verloren: 1, offen: 3 })).toBe(true);
    expect(vieleOffen({ gewonnen: 2, verloren: 1, offen: 3 })).toBe(false);
  });
});
