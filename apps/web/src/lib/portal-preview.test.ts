import { describe, expect, it } from "vitest";
import { portalPreview, portalSperre, widerrufBeiPortalAus, widerrufOhnePortalDaten } from "./portal-preview";

const usable = {
  branding: { displayName: "Kottke Umzüge", primaryColor: "ff8200" },
  dealNumber: "KOT-2026-042",
  customerDisplayName: "Max Mustermann",
  meta: { revoked: false, featureDisabled: false },
} as unknown as Parameters<typeof portalPreview>[0];

describe("portalSperre", () => {
  it("reports revoked before disabled", () => {
    expect(portalSperre({ revoked: true, featureDisabled: true })).toBe("revoked");
  });

  it("reports disabled", () => {
    expect(portalSperre({ revoked: false, featureDisabled: true })).toBe("disabled");
  });

  it("returns null for a usable link", () => {
    expect(portalSperre({ revoked: false, featureDisabled: false })).toBeNull();
  });
});

describe("portalPreview", () => {
  it("is neutral for an unknown token", () => {
    expect(portalPreview(null)).toEqual({
      neutral: true,
      firma: "Auftrag",
      dealNumber: "",
      primaryColor: null,
    });
  });

  it("does not show the customer of a revoked link", () => {
    const p = portalPreview({ ...usable!, meta: { revoked: true, featureDisabled: false } } as never);
    expect(p.neutral).toBe(true);
    expect(p.dealNumber).toBe("");
  });

  it("is neutral when the portal is switched off", () => {
    expect(
      portalPreview({ ...usable!, meta: { revoked: false, featureDisabled: true } } as never).neutral
    ).toBe(true);
  });

  // Die Vorschau sieht jeder, an den der Link weitergeleitet wird (Gruppe,
  // Weiterleitung, Crawler), bevor er geöffnet ist. Der Name bleibt im Portal.
  it("shows firma and deal number but never the customer name", () => {
    expect(portalPreview(usable)).toEqual({
      neutral: false,
      firma: "Kottke Umzüge",
      dealNumber: "KOT-2026-042",
      primaryColor: "ff8200",
    });
  });
});

// § 356a BGB: Der Widerrufsbutton steht während der ganzen Frist bereit, auch
// wenn die Firma das Portal ausschaltet. Ein gesperrter Link bleibt zu.
describe("widerrufBeiPortalAus", () => {
  const aktiv = { aktiv: true, eingegangen: null };
  it("Portal aus, Frist läuft: Button bleibt", () => {
    expect(widerrufBeiPortalAus({ meta: { revoked: false, featureDisabled: true }, widerruf: aktiv })).toBe(true);
  });
  it("Portal aus, Widerruf schon eingegangen: Hinweis bleibt", () => {
    expect(widerrufBeiPortalAus({ meta: { revoked: false, featureDisabled: true }, widerruf: { aktiv: false, eingegangen: { at: "2026-10-20T10:00:00Z" } } })).toBe(true);
  });
  it("Portal aus, kein Widerrufsrecht: nichts", () => {
    expect(widerrufBeiPortalAus({ meta: { revoked: false, featureDisabled: true }, widerruf: { aktiv: false, eingegangen: null } })).toBe(false);
  });
  it("gesperrter Link: nichts, auch bei laufender Frist", () => {
    expect(widerrufBeiPortalAus({ meta: { revoked: true, featureDisabled: true }, widerruf: aktiv })).toBe(false);
  });
});

// Bei „Portal aus“ geht nur an den Browser, was der Widerrufsbutton braucht:
// keine Bankdaten, kein PayPal, kein restliches Branding.
describe("widerrufOhnePortalDaten", () => {
  it("nur Widerruf, Firmenname und Farbe", () => {
    const widerruf = { aktiv: true, eingegangen: null, fristEnde: "2026-11-12" };
    const daten = widerrufOhnePortalDaten({
      widerruf,
      branding: { displayName: "Kottke Umzüge", primaryColor: "c2570c", bank: { iban: "DE00" }, paypal: { handleOrEmail: "x" } },
    } as never);
    expect(daten).toEqual({ widerruf, branding: { displayName: "Kottke Umzüge", primaryColor: "c2570c" } });
  });
});
