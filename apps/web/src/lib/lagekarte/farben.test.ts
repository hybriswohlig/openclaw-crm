import { describe, expect, it } from "vitest";
import { euroAusCent } from "./farben";

describe("euroAusCent (M-4)", () => {
  it("zeigt zwei Nachkommastellen, wenn der Betrag nicht ganz ist", () => {
    expect(euroAusCent(124_950)).toBe("1.249,50 €");
    expect(euroAusCent(45_050)).toBe("450,50 €");
    expect(euroAusCent(12_050)).toBe("120,50 €");
    expect(euroAusCent(1)).toBe("0,01 €");
  });

  it("zeigt ganze Beträge ohne Nachkommastellen, auch große", () => {
    expect(euroAusCent(189_000)).toBe("1.890 €");
    expect(euroAusCent(0)).toBe("0 €");
    expect(euroAusCent(1_000_000_000)).toBe("10.000.000 €");
  });
});
