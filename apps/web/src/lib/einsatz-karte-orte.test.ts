import { describe, expect, it } from "vitest";
import { kartenOrtSchluessel, kreisPunkte, luftlinieKm, ortAusAdresse, UMKREIS_KM, UMKREIS_VORGABE } from "./einsatz";

describe("ortAusAdresse", () => {
  it.each([
    ["Königstraße 1, 70173 Stuttgart", "70173", "Stuttgart"],
    ["Königstr. 1, 70173 Stuttgart, Deutschland", "70173", "Stuttgart"],
    ["70372 Stuttgart", "70372", "Stuttgart"],
    ["70372 Stuttgart-Bad Cannstatt", "70372", "Stuttgart-Bad Cannstatt"],
    ["Hauptstr. 5, 71032 Böblingen; 2. OG", "71032", "Böblingen"],
    ["innerhalb Böblingen", null, "Böblingen"],
    ["Umzug innerhalb von Esslingen", null, "Esslingen"],
    ["Böblingen", null, "Böblingen"],
    ["Hauptstraße 5, Leonberg", null, "Leonberg"],
    ["70173", "70173", null],
    ["Hauptstraße 5", null, null],
    ["", null, null],
    [null, null, null],
  ])("%s", (adresse, plz, ort) => {
    expect(ortAusAdresse(adresse as string | null)).toEqual({ plz, ort });
  });
});

describe("kartenOrtSchluessel", () => {
  it("mit PLZ wie ortSchluessel, nur Ort mit Vorsilbe, sonst null", () => {
    expect(kartenOrtSchluessel("70176", " Stuttgart ")).toBe("70176 stuttgart");
    expect(kartenOrtSchluessel(null, "Böblingen")).toBe("ort:böblingen");
    expect(kartenOrtSchluessel("123", "Böblingen")).toBe("ort:böblingen");
    expect(kartenOrtSchluessel("70176", null)).toBeNull();
    expect(kartenOrtSchluessel(null, " ")).toBeNull();
  });
});

describe("Umkreis", () => {
  it("Wahl 15, 30, 50 km, Vorgabe 30", () => {
    expect([...UMKREIS_KM]).toEqual([15, 30, 50]);
    expect(UMKREIS_VORGABE).toBe(30);
  });

  it("Ring ist geschlossen und liegt im Abstand km", () => {
    const mitte: [number, number] = [9.18, 48.78];
    const ring = kreisPunkte(mitte, 30, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const p of ring) expect(luftlinieKm(mitte, p)).toBeCloseTo(30, 0);
  });

  it("Luftlinie Stuttgart Böblingen rund 18 km", () => {
    expect(luftlinieKm([9.1829, 48.7758], [9.0115, 48.6833])).toBeGreaterThan(15);
    expect(luftlinieKm([9.1829, 48.7758], [9.0115, 48.6833])).toBeLessThan(20);
  });
});
