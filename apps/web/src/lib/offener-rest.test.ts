import { describe, expect, it } from "vitest";
import { restAus } from "./offener-rest";

const leer = { annahmeCent: null, festpreis: null, istStunden: false, zahlungen: [] as { amount: string; taxTreatment: string | null }[] };

describe("restAus", () => {
  it("nimmt die Annahme und lässt nicht steuerbare Zahlungen weg", () => {
    expect(
      restAus({
        ...leer,
        annahmeCent: 248000,
        zahlungen: [
          { amount: "500.00", taxTreatment: "betriebseinnahme" },
          { amount: "200.00", taxTreatment: "nicht_steuerbar" },
        ],
      }),
    ).toEqual({ gesamtCent: 248000, bezahltCent: 50000, restCent: 198000, quelle: "annahme" });
  });

  it("ohne Annahme kommt der Festpreis aus dem Angebot", () => {
    expect(restAus({ ...leer, festpreis: "2480.00" })).toEqual({
      gesamtCent: 248000,
      bezahltCent: 0,
      restCent: 248000,
      quelle: "angebot",
    });
  });

  it("Stunden-KV hat keinen Rest, auch wenn ein Festpreis gespeichert ist", () => {
    expect(restAus({ ...leer, istStunden: true, festpreis: "2480.00" })).toEqual({
      gesamtCent: null,
      bezahltCent: 0,
      restCent: null,
      quelle: "stunden",
    });
  });

  it("ohne Annahme und ohne Angebot bleibt der Rest leer", () => {
    expect(restAus(leer)).toEqual({ gesamtCent: null, bezahltCent: 0, restCent: null, quelle: "keins" });
  });

  it("Überzahlung klemmt den Rest auf 0", () => {
    expect(
      restAus({
        ...leer,
        annahmeCent: 10000,
        zahlungen: [{ amount: "200.00", taxTreatment: "betriebseinnahme" }],
      }),
    ).toEqual({ gesamtCent: 10000, bezahltCent: 20000, restCent: 0, quelle: "annahme" });
  });

  it("eine Annahme schlägt den Stunden-KV", () => {
    expect(restAus({ ...leer, annahmeCent: 248000, istStunden: true }).quelle).toBe("annahme");
  });
});
