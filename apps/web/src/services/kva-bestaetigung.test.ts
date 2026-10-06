import { describe, expect, it } from "vitest";
import { agbAlsText, bestaetigungVerschickt, bestaetigungsMailText, bestaetigungsTextWhatsApp, nachlaufNoetig, teamAlarmText, type BestaetigungsDaten } from "./kva-bestaetigung";
import { firmaKontakt } from "@openclaw-crm/customer-portal-core";

const umzug: BestaetigungsDaten = {
  firma: "Kottke Dienstleistungen", kontakt: firmaKontakt("kottke"), dealNumber: "K-1042",
  kunde: "Max Muster", preisCents: 124000, optionName: "Komfort", moveDate: "2026-11-02",
  fromAddress: "Hauptstr. 1, 72218 Wildberg", toAddress: "Bahnhofstr. 5, 75365 Calw",
  widerrufModus: "ausgeschlossen", vorzeitigerBeginn: false, haftung: true, versicherungGewuenscht: true,
  portalUrl: "https://status.kottke-umzuege.de/s/abc", signedAt: "2026-10-06T08:00:00.000Z", pdfDabei: true,
};

describe("bestaetigungsTextWhatsApp", () => {
  it("trägt Vertragsdaten, Widerrufshinweis und Haftungshinweis", () => {
    const t = bestaetigungsTextWhatsApp(umzug);
    expect(t).toContain("K-1042");
    expect(t).toContain("1.240");
    expect(t).toContain("Komfort");
    expect(t).toContain("2. November 2026");
    expect(t).toContain("Hauptstr. 1");
    expect(t).toContain("Bahnhofstr. 5");
    expect(t).toContain("kein gesetzliches Widerrufsrecht");
    expect(t).toContain("§ 451g HGB");
    expect(t).not.toMatch(/[—–]/);
  });
  it("ohne PDF: Hinweis auf Portal", () => {
    expect(bestaetigungsTextWhatsApp({ ...umzug, pdfDabei: false })).toContain(umzug.portalUrl);
  });
  it("Küche: Belehrung statt Ausschluss, kein § 451g", () => {
    const t = bestaetigungsTextWhatsApp({ ...umzug, widerrufModus: "belehrung", haftung: false, versicherungGewuenscht: false, vorzeitigerBeginn: true });
    expect(t).toContain("Widerrufsbelehrung");
    expect(t).toContain("vor Ende der Widerrufsfrist");
    expect(t).not.toContain("§ 451g");
  });
});

describe("bestaetigungsMailText", () => {
  it("Küche: volle Belehrung und Formular", () => {
    const t = bestaetigungsMailText({ ...umzug, widerrufModus: "belehrung", haftung: false });
    expect(t).toContain("Muster-Widerrufsformular");
    expect(t).toContain("binnen vierzehn Tagen");
  });
});

describe("teamAlarmText", () => {
  it("nennt Auftrag, Kunde, Preis und Versicherungswunsch", () => {
    const t = teamAlarmText(umzug);
    expect(t).toContain("Angebot angenommen");
    expect(t).toContain("K-1042");
    expect(t).toContain("Max Muster");
    expect(t).toContain("Versicherung");
  });
});

describe("Fix-Durchgang Bestätigung", () => {
  const kueche: BestaetigungsDaten = { ...umzug, widerrufModus: "belehrung", haftung: false, versicherungGewuenscht: false, kontakt: firmaKontakt("ceylan") };
  it("Küche per WhatsApp: volle Belehrung und Formular, unter 4096 Zeichen", () => {
    const t = bestaetigungsTextWhatsApp(kueche);
    expect(t).toContain("binnen vierzehn Tagen");
    expect(t).toContain("Muster-Widerrufsformular");
    expect(t).not.toContain("in der E-Mail");
    expect(t.length).toBeLessThan(4096);
  });
  it("variables Angebot: voraussichtlich statt Endpreis", () => {
    const t = bestaetigungsTextWhatsApp({ ...umzug, voraussichtlich: true });
    expect(t).toContain("voraussichtlich");
    expect(t).not.toContain("Endpreis");
    expect(bestaetigungsMailText({ ...umzug, voraussichtlich: true })).not.toContain("Endpreis");
  });
  it("Mail ohne PDF und ohne AGB: keine Anhang-Behauptung, Verweis aufs Portal", () => {
    const t = bestaetigungsMailText({ ...umzug, pdfDabei: false, agbDabei: false });
    expect(t).not.toContain("Im Anhang");
    expect(t).toContain(umzug.portalUrl);
  });
  it("Mail mit PDF und AGB: nennt beide Anhänge", () => {
    expect(bestaetigungsMailText({ ...umzug, pdfDabei: true, agbDabei: true })).toContain("Im Anhang finden Sie das angenommene Angebot als PDF und unsere AGB");
  });
});

describe("bestaetigungVerschickt / nachlaufNoetig", () => {
  it("Altbestand ohne Widerrufsmodus: kein Nachlauf", () => {
    expect(nachlaufNoetig({ widerrufModus: null, confirmationSentAt: null, confirmationChannels: null })).toBe(false);
  });
  it("neue Annahme ohne Versand: Nachlauf nötig", () => {
    expect(nachlaufNoetig({ widerrufModus: "ausgeschlossen", confirmationSentAt: null, confirmationChannels: null })).toBe(true);
  });
  it("laufender Versand gilt nicht als verschickt", () => {
    expect(bestaetigungVerschickt({ confirmationSentAt: new Date(), confirmationChannels: "sending" })).toBe(false);
    expect(bestaetigungVerschickt({ confirmationSentAt: new Date(), confirmationChannels: "whatsapp" })).toBe(true);
  });
});

describe("agbAlsText", () => {
  it("macht aus der AGB-Seite lesbaren Text", () => {
    const t = agbAlsText("<html><head><style>p{}</style></head><body><h1>AGB</h1><p>§ 1 Geltung &amp; Umfang</p><p>„Text“</p></body></html>");
    expect(t).toContain("AGB");
    expect(t).toContain("§ 1 Geltung & Umfang");
    expect(t).not.toContain("<p>");
    expect(t).not.toContain("p{}");
  });
});
