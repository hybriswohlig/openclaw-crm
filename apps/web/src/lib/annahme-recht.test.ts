import { describe, expect, it } from "vitest";
import {
  annahmeRegeln,
  annahmeSperrgrund,
  erwarteterGesamtpreis,
  widerrufModus,
  widerrufsbelehrung,
  firmaKontakt,
  BUTTON_ZAHLUNGSPFLICHTIG,
  type ConfirmKvaPayload,
} from "@openclaw-crm/customer-portal-core";

const now = new Date("2026-10-06T10:00:00+02:00");
const payload = (p: Partial<ConfirmKvaPayload> = {}): ConfirmKvaPayload => ({
  acceptedOffer: true,
  acceptedAgb: true,
  haftungshinweisBestaetigt: true,
  versicherungGewuenscht: false,
  vorzeitigerBeginnVerlangt: false,
  expectedTotalCents: 120000,
  fullName: null,
  ...p,
});

describe("widerrufModus", () => {
  it("Umzug: ausgeschlossen, Küche: Belehrung", () => {
    expect(widerrufModus("move")).toBe("ausgeschlossen");
    expect(widerrufModus("kitchen_installation")).toBe("belehrung");
  });
});

describe("annahmeRegeln", () => {
  it("Umzug ohne Termin und ohne Terminangebot: Termin fehlt", () => {
    const r = annahmeRegeln({ serviceType: "move", moveDate: null, hasOpenDateChoice: false, now });
    expect(r.terminFehlt).toBe(true);
    expect(r.haftungshinweisErforderlich).toBe(true);
    expect(r.vorzeitigerBeginnErforderlich).toBe(false);
  });
  it("Umzug mit offener Terminwahl: Termin fehlt", () => {
    const r = annahmeRegeln({ serviceType: "move", moveDate: "2026-11-01", hasOpenDateChoice: true, now });
    expect(r.terminFehlt).toBe(true);
  });
  it("Küche ohne Termin: kein Termin nötig, kein vorzeitiger Beginn", () => {
    const r = annahmeRegeln({ serviceType: "kitchen_installation", moveDate: null, hasOpenDateChoice: false, now });
    expect(r.terminFehlt).toBe(false);
    expect(r.vorzeitigerBeginnErforderlich).toBe(false);
    expect(r.haftungshinweisErforderlich).toBe(false);
  });
  it("Küche in 5 Tagen: vorzeitiger Beginn nötig", () => {
    const r = annahmeRegeln({ serviceType: "kitchen_installation", moveDate: "2026-10-11", hasOpenDateChoice: false, now });
    expect(r.vorzeitigerBeginnErforderlich).toBe(true);
  });
  it("Küche in 20 Tagen: kein vorzeitiger Beginn", () => {
    const r = annahmeRegeln({ serviceType: "kitchen_installation", moveDate: "2026-10-26", hasOpenDateChoice: false, now });
    expect(r.vorzeitigerBeginnErforderlich).toBe(false);
  });
});

describe("erwarteterGesamtpreis", () => {
  it("nimmt den Preis der gewählten Option", () => {
    expect(erwarteterGesamtpreis({ dealOptions: [{ id: "a", priceCents: 90000 }, { id: "b", priceCents: 130000 }], selectedOptionId: "b", totalCents: 1 })).toBe(130000);
  });
  it("ohne Optionen: totalCents", () => {
    expect(erwarteterGesamtpreis({ dealOptions: [], selectedOptionId: null, totalCents: 120000 })).toBe(120000);
  });
});

describe("annahmeSperrgrund", () => {
  const umzug = annahmeRegeln({ serviceType: "move", moveDate: "2026-11-01", hasOpenDateChoice: false, now });
  const kueche = annahmeRegeln({ serviceType: "kitchen_installation", moveDate: "2026-10-09", hasOpenDateChoice: false, now });
  it("vollständige Umzugs-Annahme: frei", () => {
    expect(annahmeSperrgrund({ payload: payload(), regeln: umzug, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBeNull();
  });
  it("Angebot oder AGB nicht bestätigt", () => {
    expect(annahmeSperrgrund({ payload: payload({ acceptedOffer: false }), regeln: umzug, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("missing_acknowledgement");
    expect(annahmeSperrgrund({ payload: payload({ acceptedAgb: false }), regeln: umzug, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("missing_acknowledgement");
  });
  it("Preis weicht ab", () => {
    expect(annahmeSperrgrund({ payload: payload({ expectedTotalCents: 110000 }), regeln: umzug, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("price_changed");
  });
  it("Umzug ohne Haftungshinweis", () => {
    expect(annahmeSperrgrund({ payload: payload({ haftungshinweisBestaetigt: false }), regeln: umzug, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("haftungshinweis_required");
  });
  it("Küche: Haftungshinweis egal, vorzeitiger Beginn nötig", () => {
    expect(annahmeSperrgrund({ payload: payload({ haftungshinweisBestaetigt: false }), regeln: kueche, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("vorzeitiger_beginn_required");
    expect(annahmeSperrgrund({ payload: payload({ haftungshinweisBestaetigt: false, vorzeitigerBeginnVerlangt: true }), regeln: kueche, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBeNull();
  });
  it("Termin fehlt", () => {
    const ohne = annahmeRegeln({ serviceType: "move", moveDate: null, hasOpenDateChoice: false, now });
    expect(annahmeSperrgrund({ payload: payload(), regeln: ohne, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("date_required");
  });
});

describe("rechtstexte", () => {
  it("Button nennt die Zahlungspflicht", () => {
    expect(BUTTON_ZAHLUNGSPFLICHTIG).toBe("Zahlungspflichtig beauftragen");
  });
  it("Belehrung nennt Firma und Anschrift, ohne Gedankenstriche", () => {
    const b = widerrufsbelehrung(firmaKontakt("ceylan"));
    const text = b.absaetze.join(" ");
    expect(text).toContain("Ceylan Umzüge & Transporte");
    expect(text).toContain("Kapellenberg 13");
    expect(text).not.toMatch(/[—–]/);
  });
});

describe("firmaKontakt", () => {
  it("Kottke hat eine E-Mail für Widerruf und Impressum (§ 5 DDG)", () => {
    expect(firmaKontakt("kottke").email).toBe("kontakt@kottke-umzuege.de");
  });
  it("Ceylan hat eine Telefonnummer (Gestaltungshinweis 2 der Muster-Belehrung)", () => {
    expect(firmaKontakt("ceylan").telefon).toBe("+49 156 78305579");
    expect(widerrufsbelehrung(firmaKontakt("ceylan")).absaetze.join(" ")).toContain("Telefon +49 156 78305579");
  });
});

describe("Fix-Durchgang: 14-Tage-Grenze mit Puffer", () => {
  const k = (moveDate: string) =>
    annahmeRegeln({ serviceType: "kitchen_installation", moveDate, hasOpenDateChoice: false, now });
  it("Termin genau 14 Tage nach Vertragsschluss liegt noch in der Frist", () => {
    expect(k("2026-10-20").vorzeitigerBeginnErforderlich).toBe(true);
  });
  it("Puffer für Wochenende und Feiertag bis 17 Tage", () => {
    expect(k("2026-10-23").vorzeitigerBeginnErforderlich).toBe(true);
  });
  it("ab 18 Tagen kein vorzeitiger Beginn nötig", () => {
    expect(k("2026-10-24").vorzeitigerBeginnErforderlich).toBe(false);
  });
});

describe("Fix-Durchgang: parseConfirmKvaPayload", () => {
  it("null oder kein Objekt: null", async () => {
    const { parseConfirmKvaPayload } = await import("@openclaw-crm/customer-portal-core");
    expect(parseConfirmKvaPayload(null)).toBeNull();
    expect(parseConfirmKvaPayload("x")).toBeNull();
  });
  it("nur echtes true zählt, Name nur als String", async () => {
    const { parseConfirmKvaPayload } = await import("@openclaw-crm/customer-portal-core");
    const p = parseConfirmKvaPayload({ acceptedOffer: "true", acceptedAgb: true, haftungshinweisBestaetigt: 1, expectedTotalCents: 5, fullName: 42 });
    expect(p).toEqual({
      acceptedOffer: false,
      acceptedAgb: true,
      haftungshinweisBestaetigt: false,
      versicherungGewuenscht: false,
      vorzeitigerBeginnVerlangt: false,
      expectedTotalCents: 5,
      fullName: null,
    });
  });
  it("fehlender Preis (alter Browser-Stand) führt zu price_changed", async () => {
    const { parseConfirmKvaPayload } = await import("@openclaw-crm/customer-portal-core");
    const p = parseConfirmKvaPayload({ acceptedOffer: true, acceptedAgb: true, haftungshinweisBestaetigt: true })!;
    const regeln = annahmeRegeln({ serviceType: "move", moveDate: "2026-11-01", hasOpenDateChoice: false, now });
    expect(annahmeSperrgrund({ payload: p, regeln, agbVorhanden: true, aktuellerPreisCents: 120000 })).toBe("price_changed");
  });
});
