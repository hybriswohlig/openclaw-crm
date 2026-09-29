import { describe, expect, it } from "vitest";
import { heuteBerlin, leadQuelle, markeAusFirmenname } from "./quelle";

// Echte Relay-Form laut isKleinanzeigenRelayAddress: <name>-<40+ Hex>-ek-ek@mail.kleinanzeigen.de
const RELAY = `abc-${"a1".repeat(20)}-ek-ek@mail.kleinanzeigen.de`;

describe("markeAusFirmenname", () => {
  it("erkennt beide Firmen, sonst null", () => {
    expect(markeAusFirmenname("Kottke-Umzüge")).toBe("kottke");
    expect(markeAusFirmenname("Ceylan Operations")).toBe("ceylan");
    expect(markeAusFirmenname("Rümpeltürken")).toBe("ceylan");
    expect(markeAusFirmenname(null)).toBeNull();
    expect(markeAusFirmenname("Irgendwas")).toBeNull();
  });
});

describe("leadQuelle", () => {
  it("ImmoScout-Import im Deal → Vergleichsportal, auch wenn der Lead per WhatsApp weiterläuft", () => {
    expect(leadQuelle({ payloadSource: "immoscout24", konversationen: [{ kontaktEmail: null, betreff: null }] })).toBe("vergleichsportal");
  });
  it("ImmoScout-Absender in einer verknüpften Konversation → Vergleichsportal", () => {
    expect(leadQuelle({ payloadSource: null, konversationen: [{ kontaktEmail: "noreply@immobilienscout24.de", betreff: "IS24 Umzugsanfrage" }] })).toBe("vergleichsportal");
  });
  it("Kleinanzeigen-Relay oder Betreff → Kleinanzeigen", () => {
    expect(leadQuelle({ payloadSource: null, konversationen: [{ kontaktEmail: RELAY, betreff: null }] })).toBe("kleinanzeigen");
    expect(leadQuelle({ payloadSource: null, konversationen: [{ kontaktEmail: null, betreff: "Nutzer-Anfrage zu deiner Anzeige" }] })).toBe("kleinanzeigen");
  });
  it("Vergleichsportal schlägt Kleinanzeigen", () => {
    expect(leadQuelle({ payloadSource: "immoscout24", konversationen: [{ kontaktEmail: RELAY, betreff: null }] })).toBe("vergleichsportal");
  });
  it("sonstige Konversation → direkt, keine Konversation → unbekannt", () => {
    expect(leadQuelle({ payloadSource: null, konversationen: [{ kontaktEmail: "kunde@gmx.de", betreff: "Umzug" }] })).toBe("direkt");
    expect(leadQuelle({ payloadSource: null, konversationen: [] })).toBe("unbekannt");
  });
});

describe("heuteBerlin", () => {
  it("Berliner Datum", () => expect(heuteBerlin(new Date("2026-09-27T22:30:00Z"))).toBe("2026-09-28"));
});
