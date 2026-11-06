import { describe, expect, it } from "vitest";
import { leistungFuerAngebot } from "./angebot-leistung";

describe("leistungFuerAngebot", () => {
  it("nimmt die angegebene Leistung, die Kombination als Umzug mit Zusatz", () => {
    expect(leistungFuerAngebot({ angegeben: "kitchen_installation", neu: false, text: null })).toEqual({
      serviceType: "kitchen_installation",
      mitEntruempelung: false,
      bestaetigt: true,
    });
    expect(leistungFuerAngebot({ angegeben: "clearance_move", neu: true, text: null })).toEqual({
      serviceType: "move",
      mitEntruempelung: true,
      bestaetigt: true,
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
      bestaetigt: false,
    });
    expect(leistungFuerAngebot({ angegeben: undefined, neu: true, text: "Umzug 2 Zimmer" })).toBeNull();
  });
});

describe("leistungNachAussen", () => {
  it("gibt die Kombination dem Bot als clearance_move aus, mit und ohne Hülle", async () => {
    const { leistungNachAussen } = await import("./mcp/dispatch");
    const q = { serviceType: "move", documentDetails: { mitEntruempelung: true } };
    expect((leistungNachAussen(q) as { serviceType: string }).serviceType).toBe("clearance_move");
    expect((leistungNachAussen({ data: q }) as { data: { serviceType: string } }).data.serviceType).toBe("clearance_move");
    expect(leistungNachAussen({ serviceType: "move", documentDetails: null })).toEqual({ serviceType: "move", documentDetails: null });
    expect(leistungNachAussen({ data: null })).toEqual({ data: null });
  });
});
