import { describe, expect, it } from "vitest";
import { apiUrl, datum, euro, firmaKurz, gespraechZiel, istKundenAnsicht, kundenUrl } from "./kunden-logik";

describe("kunden-logik", () => {
  it("URL der Seite und der API", () => {
    expect(kundenUrl("kunden", "")).toBe("/app/kunden");
    expect(kundenUrl("anfragen", " Müller ")).toBe("/app/kunden?ansicht=anfragen&q=M%C3%BCller");
    expect(apiUrl("ohne_kunde", "", "d9")).toBe("/api/v1/kunden?ansicht=ohne_kunde&weiter=d9");
    expect(istKundenAnsicht("anfragen")).toBe(true);
    expect(istKundenAnsicht("alle")).toBe(false);
  });
  it("Beträge und Daten", () => {
    expect(euro(null)).toBe("unbekannt");
    expect(euro(120000).replace(/\s/g, " ")).toBe("1.200 €");
    expect(datum("2026-11-09")).toBe("09.11.2026");
    expect(datum(null)).toBeNull();
  });
  it("Gespräch öffnet die neue Inbox wie die Akte", () => {
    expect(gespraechZiel({ conversationId: "c1", dealId: "d1" })).toBe("/app/inbox?e=deal%3Ad1");
    expect(gespraechZiel({ conversationId: "c1", dealId: null })).toBe("/app/inbox?e=gespraech%3Ac1");
  });
  it("Firmen-Kurzname", () => {
    expect(firmaKurz("Umzüge Kottke GmbH")).toBe("Kottke");
    expect(firmaKurz("Ceylan Transporte")).toBe("Ceylan");
    expect(firmaKurz("Andere Firma")).toBe("Andere");
  });
});
