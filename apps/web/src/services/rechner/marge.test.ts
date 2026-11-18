import { describe, expect, it } from "vitest";
import { margeAusPreisUndKosten, margeErlaubt, margeWarnung, preisBeiMarge } from "./marge";
describe("preisBeiMarge (gleich wie im Rechner)", () => {
  it("700 bei 40 % → 1.170, bei 30 % → 1.000, 21 bei 30 % → 30", () => {
    expect(preisBeiMarge(700, 40, 10)).toBe(1170);
    expect(preisBeiMarge(700, 30, 10)).toBe(1000);
    expect(preisBeiMarge(21, 30, 10)).toBe(30);
  });
  it("0 % Marge = Selbstkosten (aufgerundet)", () => {
    expect(preisBeiMarge(700, 0, 10)).toBe(700);
  });
});

describe("Margengrenzen: Warnung außerhalb 30 bis 60, hart 0 bis 90 (18.11.)", () => {
  it("Warnung unter 30 und über 60, keine im Normalbereich", () => {
    expect(margeWarnung(22)).toBe("Marge 22 %: unter dem Normalbereich von 30 %.");
    expect(margeWarnung(75)).toBe("Marge 75 %: über dem Normalbereich von 60 %.");
    expect(margeWarnung(22.5)).toBe("Marge 22,5 %: unter dem Normalbereich von 30 %.");
    expect(margeWarnung(30)).toBeNull();
    expect(margeWarnung(60)).toBeNull();
    expect(margeWarnung(null)).toBeNull();
  });
  it("hart erlaubt 0 bis 90, darunter (unter Selbstkosten) und darüber nicht", () => {
    expect(margeErlaubt(22)).toBe(true);
    expect(margeErlaubt(75)).toBe(true);
    expect(margeErlaubt(0)).toBe(true);
    expect(margeErlaubt(90)).toBe(true);
    expect(margeErlaubt(-1)).toBe(false);
    expect(margeErlaubt(90.5)).toBe(false);
    expect(margeErlaubt(Number.NaN)).toBe(false);
  });
  it("Marge aus Preis und Selbstkosten", () => {
    expect(margeAusPreisUndKosten(630, 490)).toBe(22.2);
    expect(margeAusPreisUndKosten(0, 490)).toBeNull();
  });
});
