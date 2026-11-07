import { describe, expect, it } from "vitest";
import { firmaKontakt } from "@openclaw-crm/customer-portal-core";
import { bestaetigungsMailText, bestaetigungsTextWhatsApp, type BestaetigungsDaten } from "./kva-bestaetigung";

/**
 * Plan 5b: Bestätigungen ohne Plan-5-Wahl (Altbestand, Firmen ohne Schalter)
 * bleiben Wort für Wort wie vor Task W. Snapshots mit dem Code der Basis
 * f70e6a72 erzeugt.
 */
const kottke: BestaetigungsDaten = {
  firma: "Kottke Dienstleistungen", kontakt: firmaKontakt("kottke"), dealNumber: "K-1042",
  kunde: "Max Muster", preisCents: 124000, optionName: "Komfort", moveDate: "2026-11-02",
  fromAddress: "Hauptstr. 1, 72218 Wildberg", toAddress: "Bahnhofstr. 5, 75365 Calw",
  widerrufModus: "ausgeschlossen", vorzeitigerBeginn: false, haftung: true, versicherungGewuenscht: false,
  portalUrl: "https://status.kottke-umzuege.de/s/abc", signedAt: "2026-10-06T08:00:00.000Z", pdfDabei: true,
};
const ceylan: BestaetigungsDaten = {
  ...kottke, firma: "Ceylan Umzüge", kontakt: firmaKontakt("ceylan"), optionName: null,
  widerrufModus: "belehrung", haftung: false, vorzeitigerBeginn: true, pdfDabei: false,
};

describe("Bestätigung ohne Plan-5-Wahl wie vor 5b", () => {
  for (const [name, d] of [
    ["Kottke Paket", kottke],
    ["Kottke nach Aufwand", { ...kottke, optionName: null, voraussichtlich: true, preisCents: 9500 }],
    ["Ceylan Festpreis", ceylan],
    ["Ceylan nach Aufwand", { ...ceylan, voraussichtlich: true, preisCents: 9500 }],
  ] as Array<[string, BestaetigungsDaten]>) {
    it(`${name}: WhatsApp`, () => expect(bestaetigungsTextWhatsApp(d)).toMatchSnapshot());
    it(`${name}: E-Mail`, () => expect(bestaetigungsMailText(d)).toMatchSnapshot());
  }
});
