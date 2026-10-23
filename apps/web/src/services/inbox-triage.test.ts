import { describe, expect, it } from "vitest";
import {
  classifyInbound,
  classifyMessagingBody,
  istVomCrmGestartet,
  sollInboxPushSenden,
  VOM_CRM_GESTARTET_GRUND,
} from "./inbox-triage";

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

describe("classifyInbound — ImmobilienScout24", () => {
  it("an IS24 Umzugsanfrage is a LEAD despite the noreply sender", () => {
    const r = classifyInbound({
      fromAddr: "noreply@immobilienscout24.de",
      subject: "IS24 Umzugsanfrage: ID 95744021260604094746 / Gerrit Ermert",
    });
    expect(r.lane).toBe("lead");
  });
  it("IS24 marketing / notifications stay INFO", () => {
    expect(
      classifyInbound({ fromAddr: "noreply@immobilienscout24.de", subject: "Neue Angebote im AnfragenShop" }).lane
    ).toBe("info");
    expect(
      classifyInbound({ fromAddr: "noreply@immobilienscout24.de", subject: "Bestätigung: Ihre Anfrage & Widerrufsbelehrung" }).lane
    ).toBe("info");
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
  it("AliExpress marketing without a List-Unsubscribe header (domain rule)", () => {
    expect(classifyInbound({ fromAddr: "ae-ug-ut-interest20@mail.aliexpress.com", subject: "Top deals" }).lane).toBe("info");
    expect(classifyInbound({ fromAddr: "aeug-best-wishes-notify25@selections.aliexpress.com", subject: "Preissturz" }).lane).toBe("info");
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

// Jede eingehende E-Mail, auch Newsletter und Spam, ging als Push an alle.
// Jetzt klingeln nur echte Anfragen.
describe("sollInboxPushSenden", () => {
  it("pusht eine neue Anfrage in der Lead-Lane", () => {
    expect(sollInboxPushSenden({ lane: "lead", statusVorher: null })).toBe(true);
  });

  it("pusht nicht für info, spam oder review", () => {
    expect(sollInboxPushSenden({ lane: "info", statusVorher: null })).toBe(false);
    expect(sollInboxPushSenden({ lane: "spam", statusVorher: null })).toBe(false);
    expect(sollInboxPushSenden({ lane: "review", statusVorher: null })).toBe(false);
    expect(sollInboxPushSenden({ lane: "info", statusVorher: "open" })).toBe(false);
  });

  it("pusht nicht für Kontakte, die kein Lead sind (Bewerber, Team, Partner, privat)", () => {
    expect(sollInboxPushSenden({ lane: "kein_lead", statusVorher: "open" })).toBe(false);
    expect(sollInboxPushSenden({ lane: "kein_lead", statusVorher: null })).toBe(false);
  });

  it("pusht nach einer Lane-Heilung info → lead (die Lane nach der Nachricht zählt)", () => {
    expect(sollInboxPushSenden({ lane: "lead", statusVorher: "open" })).toBe(true);
  });

  it("pusht, wenn ein Kunde auf einen erledigten Lead-Chat antwortet", () => {
    expect(sollInboxPushSenden({ lane: "lead", statusVorher: "resolved" })).toBe(true);
  });

  it("pusht nicht, wenn der Chat vor der Nachricht als Spam markiert war", () => {
    // Der Ingest setzt den Status zurück auf open, der Operator wollte den
    // Absender aber nicht mehr hören.
    expect(sollInboxPushSenden({ lane: "spam", statusVorher: "spam" })).toBe(false);
    // Ältere Spam-Markierungen ohne Spam-Lane
    expect(sollInboxPushSenden({ lane: "lead", statusVorher: "spam" })).toBe(false);
  });

  it("Newsletter und OTP-Codes aus der Triage pushen nicht, echte Anfragen schon", () => {
    const newsletter = classifyInbound({
      fromAddr: "news@shop.example",
      subject: "Nur heute: 30 % Rabatt",
      headers: { "List-Unsubscribe": "<mailto:unsubscribe@shop.example>" },
    });
    expect(sollInboxPushSenden({ lane: newsletter.lane, statusVorher: null })).toBe(false);

    const otp = classifyMessagingBody("Dein Bestätigungscode für Facebook ist 012345.");
    expect(sollInboxPushSenden({ lane: otp.lane, statusVorher: null })).toBe(false);

    const anfrage = classifyInbound({
      fromAddr: "anna.mueller@gmx.de",
      subject: "Anfrage Umzug",
      body: "Guten Tag, ich brauche ein Angebot fuer einen Umzug von Stuttgart nach Esslingen.",
    });
    expect(sollInboxPushSenden({ lane: anfrage.lane, statusVorher: null })).toBe(true);
  });

  // KVA-Bestätigung, Portal-Dokument und Widerruf bitten den Kunden, auf die
  // Mail zu antworten. Über IMAP landet die Antwort per In-Reply-To in der
  // info-Konversation aus sendNewEmail, und die Lane-Heilung überspringt
  // manuelle Einstufungen. Vor dem Push-Filter klingelte jede dieser Antworten.
  it("pusht die Antwort des Kunden auf eine vom CRM gestartete Mail", () => {
    const konversation = { classifiedBy: "manual" as const, classificationReason: VOM_CRM_GESTARTET_GRUND };
    const antwort = classifyInbound({
      fromAddr: "anna.mueller@gmx.de",
      subject: "Re: Bestätigung Ihres Auftrags 2026-0815",
      body: "Danke für die Bestätigung. Kommen Sie am Freitag schon um 8 Uhr?",
    });
    expect(
      sollInboxPushSenden({
        lane: "info",
        statusVorher: "open",
        vomCrmGestartet: istVomCrmGestartet(konversation),
        triageLane: antwort.lane,
      })
    ).toBe(true);
    // auch wenn der Chat schon erledigt war
    expect(
      sollInboxPushSenden({ lane: "info", statusVorher: "resolved", vomCrmGestartet: true, triageLane: "lead" })
    ).toBe(true);
  });

  it("eine Abwesenheitsnotiz auf eine vom CRM gestartete Mail pusht nicht", () => {
    const abwesend = classifyInbound({
      fromAddr: "anna.mueller@gmx.de",
      subject: "Abwesenheitsnotiz: Bestätigung Ihres Auftrags 2026-0815",
      headers: { "Auto-Submitted": "auto-replied" },
    });
    expect(
      sollInboxPushSenden({ lane: "info", statusVorher: "open", vomCrmGestartet: true, triageLane: abwesend.lane })
    ).toBe(false);
  });

  it("andere info-Chats bleiben still, auch wenn die Nachricht wie eine Anfrage aussieht", () => {
    expect(
      sollInboxPushSenden({ lane: "info", statusVorher: "open", vomCrmGestartet: false, triageLane: "lead" })
    ).toBe(false);
    expect(sollInboxPushSenden({ lane: "info", statusVorher: "open", triageLane: "lead" })).toBe(false);
  });

  it("eine vom CRM gestartete Mail, die der Operator als Spam markiert hat, pusht nicht", () => {
    expect(
      sollInboxPushSenden({ lane: "spam", statusVorher: "spam", vomCrmGestartet: true, triageLane: "lead" })
    ).toBe(false);
    expect(
      sollInboxPushSenden({ lane: "info", statusVorher: "spam", vomCrmGestartet: true, triageLane: "lead" })
    ).toBe(false);
  });
});

describe("istVomCrmGestartet", () => {
  it("erkennt die Einstufung, die sendNewEmail schreibt", () => {
    expect(istVomCrmGestartet({ classifiedBy: "manual", classificationReason: VOM_CRM_GESTARTET_GRUND })).toBe(true);
  });

  it("nicht für Triage-Einstufungen und nicht nach Operator-Aktionen", () => {
    const newsletter = classifyInbound({ fromAddr: "newsletter@example.com" });
    expect(istVomCrmGestartet({ classifiedBy: newsletter.by, classificationReason: newsletter.reason })).toBe(false);
    // updateConversationStatus überschreibt den Grund beim Spam-Markieren und Wieder-Öffnen
    expect(istVomCrmGestartet({ classifiedBy: "manual", classificationReason: "vom Operator als Spam markiert" })).toBe(false);
    expect(istVomCrmGestartet({ classifiedBy: "manual", classificationReason: "vom Operator wieder geöffnet" })).toBe(false);
    expect(istVomCrmGestartet({ classifiedBy: null, classificationReason: null })).toBe(false);
  });
});
