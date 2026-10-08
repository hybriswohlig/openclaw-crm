import { describe, expect, it } from "vitest";
import { parseEuroEingabe } from "./wert-eingabe";

describe("parseEuroEingabe", () => {
  it("liest deutsche Tausender-Punkte als 1.500 Euro, nicht als 1,5", () => {
    expect(parseEuroEingabe("1.500")).toEqual({ gueltig: true, euro: 1500 });
    expect(parseEuroEingabe("1.234.567")).toEqual({ gueltig: true, euro: 1234567 });
  });

  it("akzeptiert Zahlen ohne Trenner", () => {
    expect(parseEuroEingabe("1500")).toEqual({ gueltig: true, euro: 1500 });
    expect(parseEuroEingabe("500")).toEqual({ gueltig: true, euro: 500 });
  });

  it("nimmt das Komma als Dezimaltrenner und rundet auf ganze Euro ab", () => {
    expect(parseEuroEingabe("1.500,50")).toEqual({ gueltig: true, euro: 1500 });
    expect(parseEuroEingabe("1.500,00")).toEqual({ gueltig: true, euro: 1500 });
    expect(parseEuroEingabe("999,99")).toEqual({ gueltig: true, euro: 999 });
    expect(parseEuroEingabe("1500,")).toEqual({ gueltig: true, euro: 1500 });
  });

  it("ignoriert Leerzeichen, geschützte Leerzeichen und das Euro-Zeichen", () => {
    expect(parseEuroEingabe("  2 500 €  ")).toEqual({ gueltig: true, euro: 2500 });
    expect(parseEuroEingabe("1 500 €")).toEqual({ gueltig: true, euro: 1500 });
  });

  it("leer oder höchstens 0 heißt kein Mindestwert", () => {
    expect(parseEuroEingabe("")).toEqual({ gueltig: true, euro: null });
    expect(parseEuroEingabe("   ")).toEqual({ gueltig: true, euro: null });
    expect(parseEuroEingabe("0")).toEqual({ gueltig: true, euro: null });
    expect(parseEuroEingabe("0,40")).toEqual({ gueltig: true, euro: null });
  });

  it("weist Unlesbares zurück statt es still zu übernehmen", () => {
    expect(parseEuroEingabe("abc")).toEqual({ gueltig: false });
    expect(parseEuroEingabe("1,2,3")).toEqual({ gueltig: false });
    expect(parseEuroEingabe("-500")).toEqual({ gueltig: false });
    expect(parseEuroEingabe("1500 EUR")).toEqual({ gueltig: false });
  });
});
