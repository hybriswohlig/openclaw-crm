import { describe, expect, it } from "vitest";
import { istVorschau } from "./vorschau";

describe("istVorschau", () => {
  it("Entwicklung mit demo=1: Vorschau mit Beispieldaten", () => {
    expect(istVorschau("?demo=1", "development")).toBe(true);
    expect(istVorschau("?lead=lead-3&demo=1&status=neu", "development")).toBe(true);
    expect(istVorschau("demo=1", "test")).toBe(true);
  });

  it("Produktion: nie, auch nicht mit demo=1", () => {
    expect(istVorschau("?demo=1", "production")).toBe(false);
    expect(istVorschau("?lead=x&demo=1", "production")).toBe(false);
  });

  it("ohne demo=1: nie", () => {
    expect(istVorschau("", "development")).toBe(false);
    expect(istVorschau("?demo=0", "development")).toBe(false);
    expect(istVorschau("?demo=true", "development")).toBe(false);
    expect(istVorschau("?xdemo=1", "development")).toBe(false);
  });
});
