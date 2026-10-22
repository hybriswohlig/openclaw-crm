import { describe, expect, it } from "vitest";
import { amountOf } from "./statistics";

describe("amountOf: Währungswerte aus json_value", () => {
  it("liest den Betrag aus json_value, fällt auf number_value zurück und sonst auf 0", () => {
    expect(amountOf(null, { amount: 1250, currencyCode: "EUR" })).toBe(1250);
    expect(amountOf("99", { amount: "1250.50", currencyCode: "EUR" })).toBe(1250.5);
    expect(amountOf("99", null)).toBe(99);
    expect(amountOf("99", { currencyCode: "EUR" })).toBe(99);
    expect(amountOf(null, null)).toBe(0);
    expect(amountOf("abc", { amount: "nope" })).toBe(0);
  });
});
