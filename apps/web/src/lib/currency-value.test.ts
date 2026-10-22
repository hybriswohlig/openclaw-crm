import { describe, expect, it } from "vitest";
import { currencyAmount } from "./currency-value";

// Currency attributes (the deal's `value`) are stored as JSON
// ({amount, currencyCode} from the record editor and deal insights,
// {amount, currency} from the quote calculator). Statistics read the plain
// number column instead and saw 0 for every deal.
describe("currencyAmount", () => {
  it("reads {amount, currencyCode}", () => {
    expect(currencyAmount({ amount: 1080, currencyCode: "EUR" })).toBe(1080);
  });

  it("reads {amount, currency} with a string amount", () => {
    expect(currencyAmount({ amount: "1450.50", currency: "EUR" })).toBe(1450.5);
  });

  it("falls back to a plain number", () => {
    expect(currencyAmount(1080)).toBe(1080);
    expect(currencyAmount("1080.00")).toBe(1080);
  });

  it.each([[{}], ["x"], [null], [undefined], [{ amount: "x" }], [Number.NaN]])(
    "returns null for %j",
    (value) => {
      expect(currencyAmount(value)).toBeNull();
    }
  );
});
