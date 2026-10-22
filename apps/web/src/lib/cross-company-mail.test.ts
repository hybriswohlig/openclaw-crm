import { describe, expect, it } from "vitest";
import { crossCompanyNotice, normalizeInquiryText, sameInquiryText } from "./cross-company-mail";

const ELIF =
  "Guten Tag, ich möchte am 12.11. einen Umzug von der Hauptstraße 4 in Stuttgart nach München anfragen. Drei Zimmer, zweiter Stock ohne Aufzug.";

describe("sameInquiryText", () => {
  it("matches the same text with different whitespace and umlauts", () => {
    expect(sameInquiryText(ELIF, ELIF.replace("möchte", "moechte").replace(/\s+/g, "  "))).toBe(true);
  });

  it("matches when the portal body contains the direct mail", () => {
    const wrapped = `Nachricht von Elif\n\n${ELIF}\n\nViele Grüße`;
    expect(sameInquiryText(ELIF, wrapped)).toBe(true);
  });

  it("ignores short greetings", () => {
    expect(sameInquiryText("Hallo", "Hallo")).toBe(false);
  });

  it("does not match two different inquiries", () => {
    expect(
      sameInquiryText(ELIF, "Guten Tag, bitte um ein Angebot für eine Entrümpelung in Köln, drei Räume voll mit Sperrmüll und einem Klavier.")
    ).toBe(false);
  });
});

describe("crossCompanyNotice", () => {
  it("names the other mailbox", () => {
    expect(crossCompanyNotice("Ceylan info")).toContain("Ceylan info");
  });
});

describe("normalizeInquiryText", () => {
  it("folds umlauts", () => {
    expect(normalizeInquiryText("Straße")).toBe("strasse");
  });
});
