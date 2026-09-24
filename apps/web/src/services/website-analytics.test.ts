import { describe, expect, it } from "vitest";
import { extractVisitorRef, siteForCompanyName } from "./website-analytics";

describe("extractVisitorRef", () => {
  it("findet die Anfrage-Nr. am Ende einer WhatsApp-Nachricht", () => {
    expect(extractVisitorRef("Hallo, Umzug in Calw geplant.\n\nAnfrage-Nr. 4FKV6E")).toBe("4FKV6E");
  });

  it("akzeptiert die ältere 5-stellige Nummer und Kleinschreibung", () => {
    expect(extractVisitorRef("anfrage-nr. qx7y5")).toBe("QX7Y5");
  });

  it("ignoriert Texte ohne Nummer und Zeichen außerhalb des Alphabets", () => {
    expect(extractVisitorRef("Hallo, was kostet ein Keller?")).toBeNull();
    expect(extractVisitorRef("Anfrage-Nr. 0OIL1")).toBeNull();
  });
});

describe("siteForCompanyName", () => {
  it("ordnet die Betriebe den Websites zu", () => {
    expect(siteForCompanyName("Kottke-Umzüge")).toBe("kottke");
    expect(siteForCompanyName("Ceylan Operations")).toBe("ruempeltuerken");
    expect(siteForCompanyName("Unbekannt GmbH")).toBeNull();
    expect(siteForCompanyName(null)).toBeNull();
  });
});
