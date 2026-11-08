import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZAHLUNGSREGEL_STANDARD } from "@/lib/geld";

const m = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  getActive: vi.fn(),
  listOperatingCompanyPortalSettings: vi.fn(),
  listOfferPackages: vi.fn(),
  ladeFirmenEinstellungen: vi.fn(),
  ladeBewertungModi: vi.fn(),
  listApiKeys: vi.fn(),
  buchungZeilen: [] as { ocId: string; an: boolean }[],
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => m.buchungZeilen }) }),
  },
}));
vi.mock("@/services/user-settings", () => ({ getUserSettings: m.getUserSettings }));
vi.mock("@/services/calendar/feed-token-store", () => ({ calendarFeeds: { getActive: m.getActive } }));
vi.mock("@/services/customer-portal-config", () => ({
  listOperatingCompanyPortalSettings: m.listOperatingCompanyPortalSettings,
  listOfferPackages: m.listOfferPackages,
}));
vi.mock("@/services/company-settings", () => ({ ladeFirmenEinstellungen: m.ladeFirmenEinstellungen }));
vi.mock("@/services/bewertung-modus", async () => ({
  ladeBewertungModi: m.ladeBewertungModi,
  MODUS_STANDARD: Object.freeze({ modus: "aus", seit: null, hakenPortal: false }),
}));
vi.mock("@/services/api-keys", () => ({ listApiKeys: m.listApiKeys }));

import { ladeEinstellungen } from "./einstellungen";

const JETZT = new Date("2026-11-08T10:00:00Z");

/** Portal-Zeile mit Feldern, die die Seite nicht zeigen darf. */
function portal(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    operatingCompanyRecordId: id,
    operatingCompanyName: name,
    enabled: true,
    signatureEnabled: false,
    angebotAusKalkulation: true,
    tagespreiseEnabled: false,
    googleReviewUrl: null,
    bankIban: "DE00 1234",
    agbPdfUrl: "https://agb",
    customDomain: "status.example.de",
    agentPrompt: "geheim",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.buchungZeilen = [];
  m.getUserSettings.mockResolvedValue({ uiVersion: "neu", ansichten: { darstellung: "dunkel" } });
  m.getActive.mockResolvedValue({ token: "tok123", createdAt: new Date("2026-10-01T08:00:00Z") });
  m.listOperatingCompanyPortalSettings.mockResolvedValue([
    portal("oc-k", "Kottke Umzüge", { googleReviewUrl: "https://g.page/r/kottke" }),
    portal("oc-c", "Ceylan Transporte"),
  ]);
  m.listOfferPackages.mockImplementation(async (_ws: string, oc: string) =>
    oc === "oc-k"
      ? [{ id: "p1", slug: "basis", displayName: "Basis", active: true, hebel: ["montage"], priceFromCents: 9900, includedItems: ["x"] }]
      : []
  );
  m.ladeFirmenEinstellungen.mockImplementation(async (_ws: string, oc: string) =>
    oc === "oc-k"
      ? {
          zeitposten: [{ id: "zp-1", bezeichnung: "Klavier", minuten: 60 }],
          rechnerMarke: "ceylan",
          zahlung: { ...ZAHLUNGSREGEL_STANDARD, tage: 14 },
          steuernummer: "12/345",
        }
      : { zeitposten: [], rechnerMarke: null, zahlung: { ...ZAHLUNGSREGEL_STANDARD }, steuernummer: null }
  );
  m.ladeBewertungModi.mockResolvedValue(
    new Map([["oc-k", { modus: "entwurf", seit: new Date("2026-11-01T09:00:00Z"), hakenPortal: true }]])
  );
  m.listApiKeys.mockResolvedValue([
    { id: "k1", name: "Zapier", keyPrefix: "ock_ab", scopes: ["read"], createdAt: new Date("2026-01-01"), lastUsedAt: null, expiresAt: null },
    { id: "k2", name: "MCP", keyPrefix: "ock_cd", scopes: ["*"], createdAt: new Date("2026-01-01"), lastUsedAt: new Date("2026-11-07T10:00:00Z"), expiresAt: null },
  ]);
});

describe("ladeEinstellungen", () => {
  it("Member bekommt nur „Für mich“, Firmen und Schlüssel sind null", async () => {
    const a = await ladeEinstellungen({ workspaceId: "ws", userId: "u", workspaceRole: "member" }, JETZT);
    expect(a.admin).toBe(false);
    expect(a.firmen).toBeNull();
    expect(a.apiSchluessel).toBeNull();
    expect(a.ich).toEqual({
      darstellung: "dunkel",
      kalender: { pfad: "/api/calendar/ics/tok123.ics", erstelltAm: "2026-10-01T08:00:00.000Z" },
    });
    expect(m.listOperatingCompanyPortalSettings).not.toHaveBeenCalled();
    expect(m.listApiKeys).not.toHaveBeenCalled();
  });

  it("ohne Abo und ohne gespeicherte Darstellung: Standard", async () => {
    m.getActive.mockResolvedValue(null);
    m.getUserSettings.mockResolvedValue({ uiVersion: "alt", ansichten: {} });
    const a = await ladeEinstellungen({ workspaceId: "ws", userId: "u", workspaceRole: "member" }, JETZT);
    expect(a.ich).toEqual({ darstellung: "system", kalender: { pfad: null, erstelltAm: null } });
  });

  it("Admin bekommt Firmen (nach Name) und Schlüssel (zuletzt benutzt zuerst)", async () => {
    m.buchungZeilen = [{ ocId: "oc-c", an: true }];
    const a = await ladeEinstellungen({ workspaceId: "ws", userId: "u", workspaceRole: "admin" }, JETZT);
    expect(a.admin).toBe(true);
    expect(a.firmen?.map((f) => f.id)).toEqual(["oc-c", "oc-k"]);
    const k = a.firmen!.find((f) => f.id === "oc-k")!;
    expect(k).toEqual({
      id: "oc-k",
      name: "Kottke Umzüge",
      marke: "ceylan",
      zahlung: { ...ZAHLUNGSREGEL_STANDARD, tage: 14 },
      bewertung: { modus: "entwurf", seit: "2026-11-01T09:00:00.000Z", hakenPortal: true },
      googleReviewUrl: "https://g.page/r/kottke",
      portal: { enabled: true, signatureEnabled: false, angebotAusKalkulation: true, tagespreiseEnabled: false },
      pakete: [{ id: "p1", slug: "basis", name: "Basis", aktiv: true, hebel: ["montage"] }],
      zeitposten: [{ id: "zp-1", bezeichnung: "Klavier", minuten: 60 }],
      einsatz: { buchungImPreis: false },
    });
    expect(a.apiSchluessel?.map((s) => s.id)).toEqual(["k2", "k1"]);
    expect(a.apiSchluessel?.[1]).toMatchObject({ zugriff: "lesen", ungenutzt: true });
  });

  it("Firma ohne company_settings-Zeile: Standardwerte aus Plan 9, 11 und 12, Marke aus dem Namen", async () => {
    m.buchungZeilen = [];
    const a = await ladeEinstellungen({ workspaceId: "ws", userId: "u", workspaceRole: "admin" }, JETZT);
    const c = a.firmen!.find((f) => f.id === "oc-c")!;
    expect(c.marke).toBe("ceylan");
    expect(c.zahlung).toEqual(ZAHLUNGSREGEL_STANDARD);
    expect(c.bewertung).toEqual({ modus: "aus", seit: null, hakenPortal: false });
    expect(c.einsatz).toEqual({ buchungImPreis: false });
    expect(c.googleReviewUrl).toBeNull();
  });

  it("enthält keine Felder außerhalb des Vertrags (keine IBAN, AGB, Domain, Agent-Texte, Steuernummer)", async () => {
    const a = await ladeEinstellungen({ workspaceId: "ws", userId: "u", workspaceRole: "admin" }, JETZT);
    expect(Object.keys(a).sort()).toEqual(["admin", "apiSchluessel", "firmen", "ich"]);
    expect(Object.keys(a.ich).sort()).toEqual(["darstellung", "kalender"]);
    for (const f of a.firmen!) {
      expect(Object.keys(f).sort()).toEqual(
        ["bewertung", "einsatz", "googleReviewUrl", "id", "marke", "name", "pakete", "portal", "zahlung", "zeitposten"].sort()
      );
      expect(Object.keys(f.portal).sort()).toEqual(["angebotAusKalkulation", "enabled", "signatureEnabled", "tagespreiseEnabled"]);
      for (const p of f.pakete) expect(Object.keys(p).sort()).toEqual(["aktiv", "hebel", "id", "name", "slug"]);
    }
    for (const s of a.apiSchluessel!) {
      expect(Object.keys(s).sort()).toEqual(
        ["abgelaufen", "erstelltAm", "id", "laeuftAbAm", "name", "prefix", "ungenutzt", "zugriff", "zuletztBenutztAm"].sort()
      );
    }
    const text = JSON.stringify(a);
    for (const verboten of ["DE00", "agb", "status.example.de", "geheim", "12/345"]) expect(text).not.toContain(verboten);
  });
});
