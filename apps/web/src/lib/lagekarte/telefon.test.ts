import { describe, expect, it } from "vitest";
import { telefonFuerLink } from "./telefon";

describe("telefonFuerLink", () => {
  it("behält nur Ziffern", () => {
    expect(telefonFuerLink("0171/123456")).toBe("0171123456");
    expect(telefonFuerLink("0171 - 12 34 56")).toBe("0171123456");
    expect(telefonFuerLink("(07031) 12.34-56")).toBe("07031123456");
  });

  it("behält ein führendes Plus", () => {
    expect(telefonFuerLink("+49 170 1234567")).toBe("+491701234567");
    expect(telefonFuerLink("  +49 170 1234567  ")).toBe("+491701234567");
  });

  it("entfernt ein Plus mitten in der Nummer", () => {
    expect(telefonFuerLink("0049+170+123")).toBe("0049170123");
  });

  it("lässt die eingeklammerte Null nach der Landesvorwahl weg", () => {
    expect(telefonFuerLink("+49 (0) 7031 123456")).toBe("+497031123456");
    expect(telefonFuerLink("+49(0)171/123456")).toBe("+49171123456");
  });

  it("ohne Ziffern: null", () => {
    expect(telefonFuerLink("")).toBeNull();
    expect(telefonFuerLink("   ")).toBeNull();
    expect(telefonFuerLink("+")).toBeNull();
    expect(telefonFuerLink("keine Angabe")).toBeNull();
  });
});
