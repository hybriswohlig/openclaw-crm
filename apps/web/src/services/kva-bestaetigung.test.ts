import { describe, expect, it } from "vitest";
import { bestaetigungsMailText, bestaetigungsTextWhatsApp, teamAlarmText, type BestaetigungsDaten } from "./kva-bestaetigung";
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
