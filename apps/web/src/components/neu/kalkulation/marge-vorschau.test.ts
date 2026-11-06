import { describe, expect, it } from "vitest";
import type { MargeAnsicht } from "@/lib/kalkulations-ansicht";
import { margeVorschau } from "./marge-vorschau";

const WEBER: MargeAnsicht = {
  vorschlagProzent: 37,
  gewaehltProzent: 38,
  gewaehltVon: "Dario",
  gruende: [],
  min: 30,
  max: 60,
  rundungEur: 10,
  selbstkostenEur: 1533,
};

describe("margeVorschau", () => {
  it("1.533 € Selbstkosten bei 38 % und Rundung 10 € ergeben 2.480 € Preis und 947 € Gewinn", () => {
    expect(margeVorschau(WEBER, 38)).toEqual({ preisCent: 248000, gewinnCent: 94700 });
  });

  it("rundet immer auf den nächsten Rundungsschritt auf", () => {
    // 1.533 ÷ 0,70 = 2.190 exakt: bleibt 2.190
    expect(margeVorschau(WEBER, 30).preisCent).toBe(219000);
    // 1.533 ÷ 0,40 = 3.832,50: auf 3.840
    expect(margeVorschau(WEBER, 60)).toEqual({ preisCent: 384000, gewinnCent: 230700 });
  });

  it("Selbstkosten mit Cent bleiben in Cent erhalten", () => {
    const m = { ...WEBER, selbstkostenEur: 1533.35 };
    // 1.533,35 ÷ 0,62 = 2.473,15: auf 2.480; Gewinn 2.480 − 1.533,35 = 946,65
    expect(margeVorschau(m, 38)).toEqual({ preisCent: 248000, gewinnCent: 94665 });
  });

  it("ohne Rundungsangabe rundet auf ganze Euro", () => {
    const m = { ...WEBER, rundungEur: 0 };
    // 1.533 ÷ 0,62 = 2.472,58: auf 2.473
    expect(margeVorschau(m, 38)).toEqual({ preisCent: 247300, gewinnCent: 94000 });
  });
});
