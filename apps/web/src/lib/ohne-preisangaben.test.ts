import { describe, expect, it } from "vitest";
import { ohnePreisangaben } from "./ohne-preisangaben";

describe("ohnePreisangaben", () => {
  it("entfernt den Satz mit dem Betrag, der Rest bleibt", () => {
    expect(ohnePreisangaben("Gern bieten wir an. Der Preis beträgt 1.250 €. Wir freuen uns.")).toBe(
      "Gern bieten wir an. Wir freuen uns."
    );
  });

  it("Text ohne Betrag bleibt gleich (auch doppelte Leerzeichen und Zeilen)", () => {
    const text = "Gern bieten wir an.\n\nWir  freuen uns auf Ihren Umzug!";
    expect(ohnePreisangaben(text)).toBe(text);
  });

  it("Zahlen ohne Währung bleiben", () => {
    expect(ohnePreisangaben("Es kommen 3 Helfer. Dauer etwa 4,5 Stunden.")).toBe(
      "Es kommen 3 Helfer. Dauer etwa 4,5 Stunden."
    );
    expect(ohnePreisangaben("3 Helfer")).toBe("3 Helfer");
  });

  it.each([
    ["Festpreis 980,50 EUR inklusive.", ""],
    ["Das kostet 200 Euro. Danke.", "Danke."],
    ["Danke. Gesamt: 1 490,00€", "Danke."],
    ["Danke. Gesamt € 1.490.", "Danke."],
  ])("%s → %s", (ein, aus) => {
    expect(ohnePreisangaben(ein)).toBe(aus);
  });

  it("Europa und Kürzel sind kein Betrag", () => {
    expect(ohnePreisangaben("Wir fahren 2 Mal durch Europa.")).toBe("Wir fahren 2 Mal durch Europa.");
  });

  it("Zeilen mit Betrag fallen weg, Absätze bleiben", () => {
    expect(ohnePreisangaben("Hallo Frau Weber,\nder Preis liegt bei 1.250 €\nViele Grüße")).toBe(
      "Hallo Frau Weber,\nViele Grüße"
    );
  });

  it("zieht nach dem Entfernen doppelte Leerzeichen zusammen", () => {
    expect(ohnePreisangaben("Gern  bieten wir an. Preis 99 €. Bis bald.")).toBe("Gern bieten wir an. Bis bald.");
  });
});
