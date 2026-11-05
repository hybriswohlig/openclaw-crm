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

  describe("Abkürzungen, Ordnungszahlen und Daten beenden keinen Satz", () => {
    it.each([
      ["Der Umzug kostet ca. 1.250 €. Wir freuen uns.", "Wir freuen uns."],
      ["Wir bieten z. B. die Montage für 120 € an. Bis bald.", "Bis bald."],
      ["Wir bieten z.B. die Montage für 120 € an. Bis bald.", "Bis bald."],
      ["Die Wohnung im 3. OG kostet 200 € mehr. Bis bald.", "Bis bald."],
      ["Am 12.11. gibt es 50 € Rabatt. Bis bald.", "Bis bald."],
      ["Am 12.11.2026 gibt es 50 € Rabatt. Bis bald.", "Bis bald."],
      ["Der Festpreis von 1.250 € gilt inkl. Montage. Wir freuen uns.", "Wir freuen uns."],
      ["Der Preis beträgt 1.250 € zzgl. MwSt. Wir freuen uns.", "Wir freuen uns."],
      ["Halteverbot ggf. zzgl. 80 €. Wir freuen uns.", "Wir freuen uns."],
      ["Montage bzw. Demontage für 90 €. Bis bald.", "Bis bald."],
      ["Evtl. Mehraufwand 60 € pro Stunde. Bis bald.", "Bis bald."],
      ["Kartons, Decken usw. für 40 €. Bis bald.", "Bis bald."],
      ["Halteverbot in der Hauptstr. 5 für 80 €. Bis bald.", "Bis bald."],
      ["Halteverbot in der Str. Am Markt für 80 €. Bis bald.", "Bis bald."],
      ["Position Nr. 4 kostet 30 €. Bis bald.", "Bis bald."],
      ["Rückfragen unter Tel. 0711 123 für 0 €. Bis bald.", "Bis bald."],
      ["Möbel u. a. Schränke für 300 €. Bis bald.", "Bis bald."],
      ["Pauschal, d. h. 500 € insgesamt. Bis bald.", "Bis bald."],
      ["Preise vgl. Angebot 450 €. Bis bald.", "Bis bald."],
    ])("%s → %s", (ein, aus) => {
      const r = ohnePreisangaben(ein);
      expect(r).toBe(aus);
      expect(r).not.toMatch(/€|EUR|Euro/i);
    });

    it("Datum am Satzende trennt, wenn ein neuer Satz folgt", () => {
      expect(ohnePreisangaben("Termin am 12.11. Wir kommen mit 3 Helfern. Gesamt 990 €.")).toBe(
        "Termin am 12.11. Wir kommen mit 3 Helfern."
      );
    });

    it("Satz mit Abkürzung ohne Betrag bleibt ganz", () => {
      expect(ohnePreisangaben("Wir kommen ca. um 8 Uhr.")).toBe("Wir kommen ca. um 8 Uhr.");
      expect(ohnePreisangaben("Wir kommen ca. um 8 Uhr. Der Preis beträgt 990 €.")).toBe("Wir kommen ca. um 8 Uhr.");
      expect(ohnePreisangaben("Preis 99 €. Wir kommen ca. um 8 Uhr.")).toBe("Wir kommen ca. um 8 Uhr.");
    });

    it("trennt nur vor Großbuchstabe, Ziffer oder öffnendem Anführungszeichen", () => {
      expect(ohnePreisangaben("Preis 99 €. „Umzug leicht gemacht“ ist unser Motto.")).toBe(
        "„Umzug leicht gemacht“ ist unser Motto."
      );
      expect(ohnePreisangaben("Preis 99 €. 3 Helfer kommen.")).toBe("3 Helfer kommen.");
      expect(ohnePreisangaben("Preis 99 €. und weiter.")).toBe("");
    });
  });

  describe("Absätze bleiben", () => {
    it("entfernter Satz vor einem Absatz: der Absatz bleibt", () => {
      expect(ohnePreisangaben("Gern bieten wir an. Der Preis beträgt 1.250 €.\n\nMit freundlichen Grüßen")).toBe(
        "Gern bieten wir an.\n\nMit freundlichen Grüßen"
      );
    });

    it("entfernter Satz am Absatzanfang: der Absatz bleibt", () => {
      expect(ohnePreisangaben("Gern bieten wir an.\n\nDer Preis beträgt 1.250 €. Wir freuen uns.")).toBe(
        "Gern bieten wir an.\n\nWir freuen uns."
      );
    });

    it("ganzer Absatz mit Betrag fällt weg, die Trennung bleibt einfach", () => {
      expect(ohnePreisangaben("Hallo,\n\nPreis 990 €.\n\nViele Grüße")).toBe("Hallo,\n\nViele Grüße");
    });
  });

  describe("deutsche Preisformate", () => {
    it.each([
      ["Der Preis beträgt 1.250,- €. Wir freuen uns.", "Wir freuen uns."],
      ["Pauschal 990,-- EUR. Wir freuen uns.", "Wir freuen uns."],
      ["Pauschal 1.250,– €. Wir freuen uns.", "Wir freuen uns."],
      ["Pauschal 1.250,–. Wir freuen uns.", "Wir freuen uns."],
      ["Pauschal 1.250,-. Wir freuen uns.", "Wir freuen uns."],
      ["Pauschal EUR 990 inklusive. Wir freuen uns.", "Wir freuen uns."],
      // Zahl vor dem Punkt kann eine Ordnungszahl sein: kein Satzende, der Nachbarsatz fällt mit weg.
      ["Pauschal EUR 990. Wir freuen uns.", ""],
    ])("%s → %s", (ein, aus) => {
      expect(ohnePreisangaben(ein)).toBe(aus);
    });

    it("Euro-Paletten sind kein Preis", () => {
      expect(ohnePreisangaben("Wir bringen 20 Euro-Paletten mit.")).toBe("Wir bringen 20 Euro-Paletten mit.");
      expect(ohnePreisangaben("Wir bringen 20 EUR-Paletten mit. Preis 99 €.")).toBe("Wir bringen 20 EUR-Paletten mit.");
    });

    it("4,5 Stunden und Bindestrich-Bereiche ohne Währung bleiben", () => {
      expect(ohnePreisangaben("Dauer 4,5 Stunden, 2-3 Helfer.")).toBe("Dauer 4,5 Stunden, 2-3 Helfer.");
    });
  });
});
