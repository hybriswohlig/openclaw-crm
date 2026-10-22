import { describe, expect, it } from "vitest";
import {
  isMoebeltransportLeadEmail,
  parseMoebeltransportLeadEmail,
} from "./inbox-moebeltransport";

/**
 * Shapes reconstructed from Möbeltransport24 lead mails (subject
 * "Angebotsanfrage NNNNN", one collective sender, customer in the body).
 * The live rows sit in inbox_messages; this environment has no database.
 */

const FROM = "anfrage@moebeltransport24.de";

const BLOCK = `
Sie haben eine neue Angebotsanfrage über Möbeltransport24 erhalten.

Anfrage-Nr.: 482913

Name: Elif Yilmaz
Telefon: 0176 1234567
E-Mail: elif.yilmaz@example.de

Von:
Hauptstraße 4
70173 Stuttgart

Nach:
Gartenweg 2
80331 München

Umzugsdatum: 12.11.2026

Details:
3-Zimmer-Wohnung, 2. OG ohne Aufzug, ca. 60 m².
`;

const INLINE = `
Kunde: Max Mustermann
Tel.: 0151/9876543
Mail: max@example.com
Umzug von: Musterweg 2, 10115 Berlin
Umzug nach: Seeallee 9, 20095 Hamburg
Termin: 01.05.2026
Nachricht: Klavier und Keller mit.
`;

const COMPANY = `
Angebotsanfrage Nr. 555001
Ansprechpartner: Firma Nordlicht GmbH
Mobil: +49 170 2223344
Email: buero@nordlicht.example
Abholadresse: Industriestr. 8, 44137 Dortmund
Zieladresse: Hafenweg 3, 28195 Bremen
Wunschtermin: 2026-08-15
Bemerkung: Büroumzug, 12 Arbeitsplätze.
`;

describe("Möbeltransport24 parser", () => {
  it("reads a block layout", () => {
    const lead = parseMoebeltransportLeadEmail("Angebotsanfrage 482913", BLOCK, FROM);
    expect(lead?.inquiryId).toBe("482913");
    expect(lead?.customer.fullName).toBe("Elif Yilmaz");
    expect(lead?.customer.email).toBe("elif.yilmaz@example.de");
    expect(lead?.customer.phone).toContain("0176");
    expect(lead?.fromLocation?.postcode).toBe("70173");
    expect(lead?.fromLocation?.city).toBe("Stuttgart");
    expect(lead?.toLocation?.city).toBe("München");
    expect(lead?.moveDate).toBe("2026-11-12");
    expect(lead?.details).toMatch(/3-Zimmer/);
  });

  it("reads inline labels and a different id spelling", () => {
    const lead = parseMoebeltransportLeadEmail("Angebotsanfrage 10022", INLINE, "noreply@moebeltransport24.de");
    expect(lead?.inquiryId).toBe("10022");
    expect(lead?.customer.fullName).toBe("Max Mustermann");
    expect(lead?.customer.email).toBe("max@example.com");
    expect(lead?.fromLocation?.city).toBe("Berlin");
    expect(lead?.toLocation?.city).toBe("Hamburg");
    expect(lead?.moveDate).toBe("2026-05-01");
    expect(lead?.details).toMatch(/Klavier/);
  });

  it("reads a business inquiry with ISO date and address labels", () => {
    const lead = parseMoebeltransportLeadEmail("Angebotsanfrage 555001", COMPANY, FROM);
    expect(lead?.customer.fullName).toBe("Firma Nordlicht GmbH");
    expect(lead?.customer.email).toBe("buero@nordlicht.example");
    expect(lead?.fromLocation?.city).toBe("Dortmund");
    expect(lead?.toLocation?.postcode).toBe("28195");
    expect(lead?.moveDate).toBe("2026-08-15");
  });

  it("takes the id from the body when the subject is generic", () => {
    const lead = parseMoebeltransportLeadEmail("Neue Anfrage", BLOCK, FROM);
    expect(lead?.inquiryId).toBe("482913");
  });

  it("ignores a normal customer mail and a portal newsletter", () => {
    expect(
      parseMoebeltransportLeadEmail(
        "Anfrage Umzug",
        "Hallo, wir ziehen um. Viele Grüße, Anna anna@example.de",
        "anna@example.de"
      )
    ).toBeNull();
    expect(isMoebeltransportLeadEmail(FROM, "Ihr Wochenrückblick", "Keine neue Anfrage.")).toBe(false);
    expect(parseMoebeltransportLeadEmail("Angebotsanfrage 12345", "Bitte um Rückruf.", "anna@example.de")).toBeNull();
  });
});
