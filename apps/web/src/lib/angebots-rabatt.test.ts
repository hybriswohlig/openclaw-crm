import { describe, expect, it } from "vitest";
import {
  applyDiscountToLines,
  normalizeLineItem,
  parseDiscount,
  parseUnitRate,
  QuotationInputError,
} from "./angebots-rabatt";

describe("parseUnitRate", () => {
  it("accepts a unicode minus and a German comma", () => {
    expect(parseUnitRate("−70")).toBe("-70.00");
    expect(parseUnitRate("–70,00 €")).toBe("-70.00");
    expect(parseUnitRate(-70)).toBe("-70.00");
    expect(parseUnitRate("1.234,50")).toBe("1234.50");
  });

  it("rejects text that is not a number", () => {
    expect(parseUnitRate("siebzig")).toBeNull();
    expect(parseUnitRate("")).toBeNull();
  });
});

describe("normalizeLineItem", () => {
  it("stores a discount type as a negative other line", () => {
    expect(normalizeLineItem({ type: "discount", description: "Rabatt bei Termin Mo–Do", quantity: 1, unitRate: "70" }, 1)).toMatchObject({
      type: "other",
      description: "Rabatt bei Termin Mo–Do",
      unitRate: "-70.00",
    });
  });

  it("keeps a negative other line", () => {
    expect(normalizeLineItem({ type: "other", description: "Rabatt", quantity: 1, unitRate: "−70,00" }, 0).unitRate).toBe("-70.00");
  });

  it("rejects an unknown type instead of letting the database 500", () => {
    expect(() => normalizeLineItem({ type: "mystery", quantity: 1, unitRate: "10" }, 0)).toThrow(QuotationInputError);
  });
});

describe("applyDiscountToLines", () => {
  it("builds 990 and -70 when the payable total is 920 and there are no lines", () => {
    const lines = applyDiscountToLines({
      fixedPrice: "920.00",
      lineItems: [],
      discount: parseDiscount({ amount: "70", label: "Rabatt bei Termin Mo–Do" }),
    });
    expect(lines.map((line) => [line.description, line.unitRate])).toEqual([
      ["Leistung", "990.00"],
      ["Rabatt bei Termin Mo–Do", "-70.00"],
    ]);
    const sum = lines.reduce((s, line) => s + line.quantity * Number(line.unitRate), 0);
    expect(sum).toBe(920);
  });

  it("keeps a 990 line and adds the discount so the sum is the fixed price", () => {
    const lines = applyDiscountToLines({
      fixedPrice: "920",
      lineItems: [{ type: "other", description: "Büroumzug", quantity: 1, unitRate: "990.00", sortOrder: 0 }],
      discount: { label: "Rabatt bei Termin Mo–Do", amountCents: 7000 },
    });
    expect(lines.map((line) => line.unitRate)).toEqual(["990.00", "-70.00"]);
    expect(lines.reduce((s, line) => s + Number(line.unitRate), 0)).toBe(920);
  });

  it("drops the discount line when discount is cleared", () => {
    const lines = applyDiscountToLines({
      fixedPrice: "920.00",
      lineItems: [
        { type: "other", description: "Büroumzug", quantity: 1, unitRate: "990.00", sortOrder: 0 },
        { type: "other", description: "Rabatt", quantity: 1, unitRate: "-70.00", sortOrder: 1 },
      ],
      discount: null,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.unitRate).toBe("990.00");
  });
});
