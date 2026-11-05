import { describe, expect, it } from "vitest";
import { leistungFuerAngebot } from "./angebot-leistung";

describe("leistungFuerAngebot", () => {
  it("nimmt die angegebene Leistung, die Kombination als Umzug mit Zusatz", () => {
    expect(leistungFuerAngebot({ angegeben: "kitchen_installation", neu: false, text: null })).toEqual({
      serviceType: "kitchen_installation",
      mitEntruempelung: false,
    });
    expect(leistungFuerAngebot({ angegeben: "clearance_move", neu: true, text: null })).toEqual({
      serviceType: "move",
      mitEntruempelung: true,
    });
  });
  it("lehnt unbekannte Werte ab", () => {
    expect(() => leistungFuerAngebot({ angegeben: "kueche", neu: true, text: null })).toThrow(/serviceType/);
  });
  it("ohne Angabe: bestehendes Angebot bleibt, neues bekommt die Leistung aus dem Text", () => {
    expect(leistungFuerAngebot({ angegeben: undefined, neu: false, text: "IKEA-Küchenmontage" })).toBeNull();
    expect(leistungFuerAngebot({ angegeben: undefined, neu: true, text: "IKEA-Küchenmontage in Stuttgart" })).toEqual({
      serviceType: "kitchen_installation",
      mitEntruempelung: false,
    });
    expect(leistungFuerAngebot({ angegeben: undefined, neu: true, text: "Umzug 2 Zimmer" })).toBeNull();
  });
});
