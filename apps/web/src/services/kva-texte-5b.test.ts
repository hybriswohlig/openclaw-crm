import { describe, expect, it } from "vitest";
import { firmaKontakt, type KvaAnnahmeSnapshot } from "@openclaw-crm/customer-portal-core";
import { annahmeWahlUndStunden, bestaetigungsMailText, bestaetigungsTextWhatsApp, type BestaetigungsDaten } from "./kva-bestaetigung";
import { mappeWahlTexte } from "./kva-unterschrift";

/**
 * Plan 5b, Entscheidung 10, F10, F11: Bestätigung (WhatsApp, E-Mail) und
 * Vertragsmappe nennen die Wahl „Gewählt: Paket am Tag: Betrag“, beim
 * Stunden-KV aus der Version die Schätzung mit Mindeststunden, beim alten
 * Stunden-KV den Stundensatz. Sie bei Ceylan, du bei Kottke.
 */
const basisSnapshot: KvaAnnahmeSnapshot = {
  isVariable: false, fixedPriceCents: 164000, lineItems: [], notes: null, totalCents: 164000, depositRequiredCents: null,
  validUntil: null, summary: null, showStandardInclusions: false, calculationAssumptions: null, calculationVersionId: "v3",
};
const mitWahl: KvaAnnahmeSnapshot = {
  ...basisSnapshot,
  wahl: { paketSlug: "komfort", paketName: "Komfort", dateOfferId: "tag-sa", datum: "2026-11-28", priceCents: 164000 },
  angebotenePreise: [{ paketSlug: "komfort", paketName: "Komfort", datum: "2026-11-28", cent: 164000 }],
};
const stundenVersion: KvaAnnahmeSnapshot = {
  ...basisSnapshot, isVariable: true, fixedPriceCents: null, totalCents: 71500, stundenModell: "version",
  stunden: { helfer: 3, transporter: 1, stundenGeschaetzt: 5.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25, summeGeschaetztCent: 71500, mindestbetragCent: 39000, quelle: "version" },
  lineItems: [
    { type: "helper", description: "Helfer je Stunde", quantity: 3, unitRate: 35, lineTotal: 105 },
    { type: "transporter", description: "Transporter je Stunde", quantity: 1, unitRate: 25, lineTotal: 25 },
  ],
};
/** Schnappschuss eines Stunden-KV von Hand, gespeichert vor 5b (ohne stundenModell). */
const stundenAltVor5b = {
  ...basisSnapshot, isVariable: true, fixedPriceCents: null, totalCents: 9500, calculationVersionId: null,
  lineItems: [
    { type: "helper", description: "Helfer", quantity: 2, unitRate: 35, lineTotal: 70 },
    { type: "transporter", description: "Transporter", quantity: 1, unitRate: 25, lineTotal: 25 },
  ],
};

const kottke = (snapshot: unknown, p: Partial<BestaetigungsDaten> = {}): BestaetigungsDaten => ({
  firma: "Kottke Dienstleistungen", kontakt: firmaKontakt("kottke"), dealNumber: "K-1042", kunde: "Max Muster",
  preisCents: (snapshot as KvaAnnahmeSnapshot).totalCents, optionName: (snapshot as KvaAnnahmeSnapshot).wahl?.paketName ?? null,
  moveDate: "2026-11-28", fromAddress: "Hauptstr. 1, 72218 Wildberg", toAddress: "Bahnhofstr. 5, 75365 Calw",
  widerrufModus: "ausgeschlossen", vorzeitigerBeginn: false, haftung: true, versicherungGewuenscht: false,
  portalUrl: "https://status.kottke-umzuege.de/s/abc", signedAt: "2026-10-06T08:00:00.000Z", pdfDabei: true,
  voraussichtlich: (snapshot as KvaAnnahmeSnapshot).isVariable,
  ...annahmeWahlUndStunden(snapshot),
  ...p,
});
const ceylan = (snapshot: unknown, p: Partial<BestaetigungsDaten> = {}): BestaetigungsDaten => ({
  ...kottke(snapshot), firma: "Ceylan Umzüge", kontakt: firmaKontakt("ceylan"), widerrufModus: "belehrung", haftung: false, ...p,
});

const alleTexte = (d: BestaetigungsDaten) => [bestaetigungsTextWhatsApp(d), bestaetigungsMailText(d)];

describe("Bestätigung mit Wahl", () => {
  it("Kottke (du): „Gewählt: Komfort am Samstag, 28. November 2026: 1.640,00 € (Endpreis)“", () => {
    for (const t of alleTexte(kottke(mitWahl))) {
      expect(t).toMatch(/Gewählt: Komfort am Samstag, 28\. November 2026: 1\.640,00\s€ \(Endpreis\)/);
      expect(t).not.toContain("Leistung: Komfort");
      expect(t).not.toContain("Preis: ");
      // Der Termin steht schon in der Wahl.
      expect(t).not.toContain("Termin: 28. November 2026");
      expect(t).toMatch(/\bdein\b|\bdir\b/);
      expect(t).not.toMatch(/\bIhr Auftrag\b|\bIhnen\b/);
      expect(t).not.toMatch(/[—–]/);
    }
  });
  it("Ceylan (Sie): gleiche Wahlzeile, Anrede Sie", () => {
    for (const t of alleTexte(ceylan(mitWahl))) {
      expect(t).toMatch(/Gewählt: Komfort am Samstag, 28\. November 2026: 1\.640,00\s€ \(Endpreis\)/);
      expect(t).toMatch(/\bIhr\b|\bIhnen\b/);
      expect(t).not.toMatch(/\bdein Auftrag\b|\bdir\b/);
      expect(t).not.toMatch(/[—–]/);
    }
  });
  it("nur Tag: „Gewählt: Termin am …“; nur Paket: ohne Tag, Termin bleibt als Zeile", () => {
    const nurTag = { ...mitWahl, wahl: { ...mitWahl.wahl!, paketSlug: null, paketName: null } };
    expect(bestaetigungsTextWhatsApp(kottke(nurTag))).toMatch(/Gewählt: Termin am Samstag, 28\. November 2026: 1\.640,00\s€ \(Endpreis\)/);
    const nurPaket = { ...mitWahl, wahl: { ...mitWahl.wahl!, dateOfferId: null, datum: null } };
    const t = bestaetigungsTextWhatsApp(kottke(nurPaket));
    expect(t).toMatch(/Gewählt: Komfort: 1\.640,00\s€ \(Endpreis\)/);
    expect(t).toContain("Termin: 28. November 2026");
  });
  it("ohne Plan-5-Wahl: Texte wie vor 5b (Leistung und Preis)", () => {
    const t = bestaetigungsTextWhatsApp(kottke(basisSnapshot, { optionName: "Komfort" }));
    expect(t).toContain("Leistung: Komfort");
    expect(t).toMatch(/Preis: 1\.640,00\s€ \(Endpreis\)/);
    expect(t).not.toContain("Gewählt");
  });
});

describe("Bestätigung beim Stunden-KV", () => {
  it("aus der Version: voraussichtlich, abgerechnet nach Aufwand, mindestens 3 Stunden", () => {
    for (const d of [kottke(stundenVersion), ceylan(stundenVersion)]) {
      for (const t of alleTexte(d)) {
        expect(t).toMatch(/Preis: voraussichtlich 715,00\s€, abgerechnet nach Aufwand, mindestens 3 Stunden \(390,00\s€\)/);
        expect(t).not.toMatch(/[—–]/);
      }
    }
  });
  it("alter Stunden-KV (Schnappschuss von vor 5b): „Stundensatz 95,00 € je Stunde“ statt voraussichtlich 95 €", () => {
    for (const d of [kottke(stundenAltVor5b), ceylan(stundenAltVor5b)]) {
      for (const t of alleTexte(d)) {
        expect(t).toMatch(/Preis: Stundensatz 95,00\s€ je Stunde \(Abrechnung nach tatsächlichem Aufwand\)/);
        expect(t).not.toMatch(/Preis: 95,00\s€ \(voraussichtlich/);
      }
    }
  });
});

describe("Vertragsmappe", () => {
  it("mit Wahl: Gewählt mit Paket, Tag und Betrag", () => {
    expect(mappeWahlTexte({ quotationSnapshot: mitWahl, confirmedTotalCents: 164000 })).toEqual({
      gewaehlt: "Gewählt: Komfort am Samstag, 28. November 2026: 1.640,00 €",
      preisAngabe: null,
    });
  });
  it("ohne Plan-5-Wahl: nichts Neues", () => {
    expect(mappeWahlTexte({ quotationSnapshot: basisSnapshot, confirmedTotalCents: 164000 })).toEqual({ gewaehlt: null, preisAngabe: null });
  });
  it("Stunden-KV aus der Version: Schätzung mit Mindeststunden", () => {
    expect(mappeWahlTexte({ quotationSnapshot: stundenVersion, confirmedTotalCents: 71500 }).preisAngabe).toEqual({
      label: "Voraussichtlich", wert: "715,00 €", text: "voraussichtlich 715,00 €, abgerechnet nach Aufwand, mindestens 3 Stunden (390,00 €)",
    });
  });
  it("alter Stunden-KV: Stundensatz je Stunde", () => {
    expect(mappeWahlTexte({ quotationSnapshot: stundenAltVor5b, confirmedTotalCents: 9500 }).preisAngabe).toEqual({
      label: "Stundensatz", wert: "95,00 € je Stunde", text: "Stundensatz 95,00 € je Stunde",
    });
  });
});
