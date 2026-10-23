import { describe, expect, it } from "vitest";
import {
  BUTTON_VERTRAG_UNTERSCHREIBEN, UNTERSCHRIFT_HINWEIS, gleicheAnnahme, naechsteAktionNachAnnahme,
  parseUnterschriftPayload, portalFeatures, unterschriftErklaerung, unterschriftMoeglich,
} from "@openclaw-crm/customer-portal-core";

const png = `data:image/png;base64,${"A".repeat(100)}`;
const annahmeAm = "2026-10-22T08:15:00.000Z";

describe("parseUnterschriftPayload", () => {
  it("gezeichnet mit PNG und Name", () => {
    expect(parseUnterschriftPayload({ art: "gezeichnet", name: " Anna Muster ", bildDataUrl: png, annahmeAm }))
      .toEqual({ art: "gezeichnet", name: "Anna Muster", bildDataUrl: png, annahmeAm });
  });
  it("getippt verwirft ein mitgeschicktes Bild", () => {
    expect(parseUnterschriftPayload({ art: "getippt", name: "Anna Muster", bildDataUrl: png, annahmeAm }))
      .toEqual({ art: "getippt", name: "Anna Muster", bildDataUrl: null, annahmeAm });
  });
  it("lehnt ab: gezeichnet ohne Bild, falsches Präfix, zu groß, Name zu kurz, unbekannte Art", () => {
    expect(parseUnterschriftPayload({ art: "gezeichnet", name: "Anna Muster", bildDataUrl: null })).toBeNull();
    expect(parseUnterschriftPayload({ art: "gezeichnet", name: "Anna Muster", bildDataUrl: "data:image/jpeg;base64,AAAA" })).toBeNull();
    expect(parseUnterschriftPayload({ art: "gezeichnet", name: "Anna Muster", bildDataUrl: `data:image/png;base64,${"A".repeat(400_001)}` })).toBeNull();
    expect(parseUnterschriftPayload({ art: "getippt", name: "A", bildDataUrl: null })).toBeNull();
    expect(parseUnterschriftPayload({ art: "foto", name: "Anna Muster", bildDataUrl: null })).toBeNull();
    expect(parseUnterschriftPayload(null)).toBeNull();
  });
  it("verlangt den Zeitpunkt der angezeigten Annahme", () => {
    expect(parseUnterschriftPayload({ art: "getippt", name: "Anna Muster", bildDataUrl: null })).toBeNull();
    expect(parseUnterschriftPayload({ art: "getippt", name: "Anna Muster", bildDataUrl: null, annahmeAm: "gestern" })).toBeNull();
  });
});

describe("unterschriftMoeglich", () => {
  const annahme = { quotationDocumentId: "doc-1", unterschrift: null };
  it("nur mit aktiver Annahme, gebundenem PDF, Einstellung an und noch ohne Unterschrift", () => {
    expect(unterschriftMoeglich({ acceptance: annahme, signatureEnabled: true })).toBe(true);
    expect(unterschriftMoeglich({ acceptance: null, signatureEnabled: true })).toBe(false);
    expect(unterschriftMoeglich({ acceptance: { ...annahme, quotationDocumentId: null }, signatureEnabled: true })).toBe(false);
    expect(unterschriftMoeglich({ acceptance: annahme, signatureEnabled: false })).toBe(false);
    expect(unterschriftMoeglich({ acceptance: { ...annahme, unterschrift: { at: "2026-10-22T10:00:00Z", name: "Anna", art: "getippt" } }, signatureEnabled: true })).toBe(false);
  });
});

describe("naechsteAktionNachAnnahme", () => {
  it("Anzahlung vor Unterschrift", () => {
    expect(naechsteAktionNachAnnahme({ anzahlungOffen: true, unterschriftMoeglich: true })).toBe("anzahlung");
    expect(naechsteAktionNachAnnahme({ anzahlungOffen: false, unterschriftMoeglich: true })).toBe("unterschrift");
    expect(naechsteAktionNachAnnahme({ anzahlungOffen: false, unterschriftMoeglich: false })).toBe("keine");
  });
});

describe("Texte und Feature", () => {
  it("exakte Texte ohne Gedankenstriche", () => {
    expect(BUTTON_VERTRAG_UNTERSCHREIBEN).toBe("Vertrag unterschreiben");
    expect(UNTERSCHRIFT_HINWEIS).toBe("Ihr Auftrag ist bereits verbindlich erteilt. Die Unterschrift ist freiwillig und dient als Vertragsurkunde.");
    expect(unterschriftErklaerung("22. Oktober 2026")).toContain("am 22. Oktober 2026 im Kundenportal");
    expect(unterschriftErklaerung("x")).not.toMatch(/[—–]/);
  });
  it("signature schließt ohne Einstellung", () => {
    expect(portalFeatures(null).signature).toBe(false);
    expect(portalFeatures({ signatureEnabled: true }).signature).toBe(true);
  });
});

describe("gleicheAnnahme", () => {
  it("vergleicht den Zeitpunkt der Annahme exakt", () => {
    expect(gleicheAnnahme(new Date("2026-10-22T08:15:00.000Z"), "2026-10-22T08:15:00.000Z")).toBe(true);
    expect(gleicheAnnahme(new Date("2026-10-22T08:15:00.000Z"), "2026-10-22T08:15:01.000Z")).toBe(false);
    expect(gleicheAnnahme(new Date("2026-10-22T08:15:00.000Z"), "kaputt")).toBe(false);
  });
});
