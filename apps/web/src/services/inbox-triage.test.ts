import { describe, expect, it } from "vitest";
import { classifyInbound, classifyMessagingBody } from "./inbox-triage";

// KOT-IDENTITY Phase 6: keep ads / bots / notifications out of the lead inbox,
// never lose a real buyer inquiry. Uses the actual noise senders from the audit.

describe("classifyInbound — Kleinanzeigen", () => {
  it("a relay buyer inquiry is a LEAD", () => {
    const r = classifyInbound({
      fromAddr: "abc-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de",
      subject: "Neue Nutzer-Anfrage zu deiner Anzeige",
    });
    expect(r.lane).toBe("lead");
  });
  it("the noreply platform catch-all is INFO (the 106-conversation bot)", () => {
    expect(classifyInbound({ fromAddr: "noreply@kleinanzeigen.de", subject: "Neue Bewertung erhalten" }).lane).toBe("info");
    expect(classifyInbound({ fromAddr: "service@kleinanzeigen.de", subject: "Dein Suchauftrag" }).lane).toBe("info");
    expect(classifyInbound({ fromAddr: "pro@von.kleinanzeigen.de", subject: "PRO-Konto Angebot" }).lane).toBe("info");
  });
});

describe("classifyInbound — bots / bulk senders go to INFO", () => {
  it("Google no-reply", () => {
    expect(classifyInbound({ fromAddr: "no-reply@accounts.google.com", subject: "Security alert" }).lane).toBe("info");
  });
  it("Facebook security via List-Unsubscribe header", () => {
    expect(classifyInbound({ fromAddr: "security@facebookmail.com", subject: "New login", headers: { "list-unsubscribe": "<https://...>" } }).lane).toBe("info");
  });
  it("AliExpress marketing via ESP-style bulk headers", () => {
    expect(classifyInbound({ fromAddr: "ae-ug-ut-interest20@mail.aliexpress.com", subject: "Deals", headers: { "Precedence": "bulk" } }).lane).toBe("info");
  });
  it("newsletter local part", () => {
    expect(classifyInbound({ fromAddr: "newsletter@example.com" }).lane).toBe("info");
  });
  it("Auto-Submitted auto-reply", () => {
    expect(classifyInbound({ fromAddr: "office@firma.de", subject: "Out of office", headers: { "Auto-Submitted": "auto-replied" } }).lane).toBe("info");
  });
});

describe("classifyInbound — real human mail stays a LEAD", () => {
  it("a plain person email with no noise signals", () => {
    const r = classifyInbound({
      fromAddr: "anna.mueller@gmx.de",
      subject: "Anfrage Umzug",
      body: "Guten Tag, ich brauche ein Angebot fuer einen Umzug von Stuttgart nach Esslingen. Koennen Sie helfen?",
    });
    expect(r.lane).toBe("lead");
  });
});

describe("classifyMessagingBody — WhatsApp/SMS OTP noise -> Info", () => {
  it("the Facebook verification code from the screenshot is INFO", () => {
    expect(classifyMessagingBody("Dein Bestätigungscode für Facebook ist 012345. Gib den Code nicht weiter.").lane).toBe("info");
  });
  it("a generic 6-digit code from a brand push name is INFO", () => {
    expect(classifyMessagingBody("123 456 is your login code", "WhatsApp").lane).toBe("info");
  });
  it("a real WhatsApp customer message stays a LEAD", () => {
    expect(classifyMessagingBody("Hallo, passt der Termin am Freitag um 14 Uhr fuer den Umzug?", "Anna").lane).toBe("lead");
  });
  it("a message that merely contains numbers (address) is NOT flagged", () => {
    expect(classifyMessagingBody("Wir ziehen von Hauptstr 12 nach Bahnhofstr 8", "Bernd").lane).toBe("lead");
  });
});
