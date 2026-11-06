import { describe, expect, it } from "vitest";
import { ZAHLUNGSART_LABEL, ZAHLUNGSARTEN, zahlungsartAus, zahlungsartText } from "./zahlungsart";

describe("zahlungsartAus", () => {
  it.each([
    ["ueberweisung", "bank_transfer"],
    [" Überweisung", "bank_transfer"],
    ["Bar", "cash"],
    ["KARTE", "card"],
    ["paypal", "paypal"],
    ["bank_transfer", "bank_transfer"],
    ["", null],
    [undefined, null],
    ["Scheck", "ungueltig"],
  ] as const)("%j → %j", (eingabe, erwartet) => {
    expect(zahlungsartAus(eingabe)).toBe(erwartet);
  });

  it("nimmt die Aufzählung und die deutschen Altwerte, sonst ungueltig", () => {
    expect(zahlungsartAus(null)).toBe(null);
    expect(zahlungsartAus("   ")).toBe(null);
    expect(zahlungsartAus("cash")).toBe("cash");
    expect(zahlungsartAus("card")).toBe("card");
    expect(zahlungsartAus("other")).toBe("other");
    expect(zahlungsartAus("sonstiges")).toBe("other");
    expect(zahlungsartAus("karte")).toBe("card");
    expect(zahlungsartAus(12)).toBe("ungueltig");
  });
});

describe("zahlungsartText", () => {
  it("zeigt das Label, sonst den Rohwert, leer „keine Angabe“", () => {
    expect(ZAHLUNGSARTEN).toEqual(["bank_transfer", "paypal", "cash", "card", "other"]);
    expect(ZAHLUNGSART_LABEL).toEqual({
      bank_transfer: "Überweisung",
      paypal: "PayPal",
      cash: "Bar",
      card: "Karte",
      other: "Sonstiges",
    });
    expect(zahlungsartText("bank_transfer")).toBe("Überweisung");
    expect(zahlungsartText("paypal")).toBe("PayPal");
    expect(zahlungsartText("cash")).toBe("Bar");
    expect(zahlungsartText("card")).toBe("Karte");
    expect(zahlungsartText("other")).toBe("Sonstiges");
    expect(zahlungsartText("Bar")).toBe("Bar");
    expect(zahlungsartText("Scheck")).toBe("Scheck");
    expect(zahlungsartText(null)).toBe("keine Angabe");
    expect(zahlungsartText("")).toBe("keine Angabe");
  });
});
