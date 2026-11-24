import { describe, expect, it } from "vitest";
import { anfahrtKundenSatz, anfahrtKundenText, firmensitzAdresse, kundenAnfahrt } from "./kunden-anfahrt";

const station = { name: "SIXT Pforzheim", anfahrtMin: 37, rueckfahrtMin: 38, anfahrtKm: 40, rueckfahrtKm: 38 };

describe("kundenAnfahrt", () => {
  it("nimmt nur die Strecke ab dem Firmensitz, nie Mietstation oder Gesamtfahrzeit", () => {
    expect(
      kundenAnfahrt({
        abSitz: { km: 15.04, minuten: 19.6, quelle: "berechnet" },
        mietstation: station,
        fahrtMinGesamt: 75,
      })
    ).toEqual({ km: 15, minuten: 20, quelle: "berechnet" });
    expect(kundenAnfahrt({ mietstation: station, fahrtMinGesamt: 75 })).toBeNull();
    expect(kundenAnfahrt({ abSitz: { km: 0, minuten: 0 } })).toBeNull();
  });

  it("Firmensitz je Gesellschaft, Mietstation ist keiner", () => {
    expect(firmensitzAdresse("kottke")).toBe("Marktstr. 8, 72218 Wildberg");
    expect(firmensitzAdresse("ceylan")).toBe("Kapellenberg 13, 72218 Wildberg");
    expect(firmensitzAdresse("sixt")).toBeNull();
  });
});

describe("anfahrtKundenText", () => {
  it("nennt Kilometer und Minuten, nie eine nackte Zahl", () => {
    expect(anfahrtKundenText({ anfahrtKm: 15, anfahrtMinuten: 20 })).toBe("ca. 15 km (ca. 20 Min.)");
    expect(anfahrtKundenSatz({ anfahrtKm: 15, anfahrtMinuten: 20 })).toBe("Anfahrt ca. 15 km (ca. 20 Min.)");
    expect(anfahrtKundenText({ anfahrtMinuten: 75 })).toBeNull();
    expect(anfahrtKundenText({ anfahrtKm: 15.5, anfahrtMinuten: null })).toBe("ca. 15,5 km");
  });
});
