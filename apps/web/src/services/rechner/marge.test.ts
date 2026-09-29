import { describe, expect, it } from "vitest";
import { preisBeiMarge } from "./marge";
describe("preisBeiMarge (gleich wie im Rechner)", () => {
  it("700 bei 40 % → 1.170, bei 30 % → 1.000, 21 bei 30 % → 30", () => {
    expect(preisBeiMarge(700, 40, 10)).toBe(1170);
    expect(preisBeiMarge(700, 30, 10)).toBe(1000);
    expect(preisBeiMarge(21, 30, 10)).toBe(30);
  });
});
