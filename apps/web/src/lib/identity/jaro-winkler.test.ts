import { describe, expect, it } from "vitest";
import { jaroWinkler, normalizeName } from "./jaro-winkler";

describe("jaroWinkler", () => {
  it("identical strings score 1", () => {
    expect(jaroWinkler("matthias ludwig", "matthias ludwig")).toBe(1);
  });
  it("close names score high", () => {
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.9);
    expect(jaroWinkler("anna mueller", "anna muller")).toBeGreaterThan(0.9);
  });
  it("different names score low", () => {
    expect(jaroWinkler("anna mueller", "bernd schmidt")).toBeLessThan(0.6);
  });
  it("empty strings score 0", () => {
    expect(jaroWinkler("", "anything")).toBe(0);
    expect(jaroWinkler("", "")).toBe(0);
  });
});

describe("normalizeName", () => {
  it("de-umlauts and lowercases", () => {
    expect(normalizeName("Müller")).toBe("mueller");
    expect(normalizeName("Bünyamin Öz")).toBe("buenyamin oez");
  });
  it("strips punctuation and collapses spaces", () => {
    expect(normalizeName("  Anna-Maria  S.  ")).toBe("anna maria s");
  });
  it("makes the same human's name match across formats", () => {
    expect(jaroWinkler(normalizeName("Matthias Ludwig"), normalizeName("matthias ludwig"))).toBe(1);
  });
});
