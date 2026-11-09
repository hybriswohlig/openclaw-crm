import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cache und Verdrahtung von `ladeUebersicht`. Die beiden SQL-Helfer laufen
 * über das gemockte `db.execute`; Deals, Kasse, Zähler und Nicht-Leads sind
 * gemockt.
 */
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ladeLeadsRoh: vi.fn(),
  ladeKasse: vi.fn(),
  ladeNavZaehler: vi.fn(),
  loadNonLeadDealIds: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/leads-board", () => ({ ladeLeadsRoh: mocks.ladeLeadsRoh }));
vi.mock("@/services/kasse", () => ({ ladeKasse: mocks.ladeKasse }));
vi.mock("@/services/heute", () => ({ ladeNavZaehler: mocks.ladeNavZaehler }));
vi.mock("@/services/kontaktart", () => ({ loadNonLeadDealIds: mocks.loadNonLeadDealIds }));

import { UEBERSICHT_CACHE_MS, ladeUebersicht, uebersichtCacheLeeren } from "./uebersicht";

const JETZT = new Date("2026-11-08T11:00:00.000Z");

const GELADEN = {
  eintraege: [],
  stamm: {
    firmen: [
      { id: "f1", name: "Kottke", farbe: "#222" },
      { id: "f2", name: "Ceylan", farbe: "#c33" },
    ],
    quellen: [],
    stufen: [],
    verlustGruende: [],
  },
  stufen: [],
  roh: [],
};

const SUMMEN = {
  meldung: { anzahl: 0, cent: 0, unbekannt: 0 },
  ohne_rechnung: { anzahl: 1, cent: 0, unbekannt: 1 },
  offen: { anzahl: 2, cent: 300, unbekannt: 0 },
  anzahlung: { anzahl: 0, cent: 0, unbekannt: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  uebersichtCacheLeeren();
  mocks.execute.mockResolvedValue([]);
  mocks.ladeLeadsRoh.mockResolvedValue(GELADEN);
  mocks.loadNonLeadDealIds.mockResolvedValue(new Set());
  mocks.ladeNavZaehler.mockResolvedValue({ heute: 4, leads: 2, kasse: 0 });
  mocks.ladeKasse.mockResolvedValue({ summen: SUMMEN, schlangen: {}, stand: JETZT.toISOString() });
});

describe("ladeUebersicht Cache", () => {
  it("merkt je Firma getrennt und gibt geladen an die Kasse weiter", async () => {
    const erste = await ladeUebersicht("ws_1", "f1", JETZT);
    const zweite = await ladeUebersicht("ws_1", "f1", JETZT);
    expect(zweite).toBe(erste);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(1);
    expect(mocks.ladeKasse).toHaveBeenCalledTimes(1);
    expect(mocks.ladeKasse).toHaveBeenCalledWith("ws_1", "f1", JETZT, GELADEN);
    expect(erste.wartetAufUns).toBe(4);
    expect(erste.offen).toEqual({
      rest: { anzahl: 2, cent: 300, unbekannt: 0 },
      ohneRechnung: { anzahl: 1, cent: 0, unbekannt: 1 },
    });
    expect(erste.firmen).toEqual([
      { id: "f1", name: "Kottke" },
      { id: "f2", name: "Ceylan" },
    ]);

    await ladeUebersicht("ws_1", "f2", JETZT);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(2);
    expect(mocks.ladeKasse).toHaveBeenLastCalledWith("ws_1", "f2", JETZT, GELADEN);
  });

  it("lädt nach 60 Sekunden neu, Zeit über jetzt", async () => {
    await ladeUebersicht("ws_1", "f1", JETZT);
    await ladeUebersicht("ws_1", "f1", new Date(JETZT.getTime() + UEBERSICHT_CACHE_MS - 1));
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(1);
    await ladeUebersicht("ws_1", "f1", new Date(JETZT.getTime() + UEBERSICHT_CACHE_MS));
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(2);
    expect(UEBERSICHT_CACHE_MS).toBe(60_000);
  });

  it("merkt Fehler nicht", async () => {
    mocks.ladeLeadsRoh.mockRejectedValueOnce(new Error("weg"));
    await expect(ladeUebersicht("ws_1", null, JETZT)).rejects.toThrow("weg");
    const neu = await ladeUebersicht("ws_1", null, JETZT);
    expect(neu.wartetAufUns).toBe(4);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(2);
  });

  it("teilt gleichzeitige Aufrufe derselben Firma ein Promise", async () => {
    const [a, b] = await Promise.all([
      ladeUebersicht("ws_1", "f1", JETZT),
      ladeUebersicht("ws_1", "f1", JETZT),
    ]);
    expect(a).toBe(b);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(1);
  });
});
