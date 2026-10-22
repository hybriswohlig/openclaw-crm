import { describe, expect, it } from "vitest";
import { MAX_PORTAL_AMOUNT_EUR, parsePortalAmountEur } from "./portal-amount";

// Crew members book cash and expenses from their phones. `"NaN"` used to pass
// the expense check (NaN <= 0 is false), got a receipt number and turned every
// profit sum into NaN; there was no upper bound either.
describe("parsePortalAmountEur", () => {
  it.each([["NaN"], [Number.NaN], ["Infinity"], [Number.POSITIVE_INFINITY], ["abc"], [""], [null], [undefined], [{}]])(
    "rejects %j",
    (raw) => {
      expect(parsePortalAmountEur(raw)).toBeNull();
    }
  );

  it("rejects zero, negative and amounts above the ceiling", () => {
    expect(parsePortalAmountEur(0)).toBeNull();
    expect(parsePortalAmountEur(-5)).toBeNull();
    expect(parsePortalAmountEur(MAX_PORTAL_AMOUNT_EUR + 0.01)).toBeNull();
  });

  it("accepts numbers, numeric strings and German decimals", () => {
    expect(parsePortalAmountEur(42)).toBe(42);
    expect(parsePortalAmountEur("12,50")).toBe(12.5);
    expect(parsePortalAmountEur("1080.00")).toBe(1080);
    expect(parsePortalAmountEur(MAX_PORTAL_AMOUNT_EUR)).toBe(25_000);
  });
});
