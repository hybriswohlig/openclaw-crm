import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZAHLUNGSREGEL_STANDARD, kasseZaehler, type RechnungKurz } from "@/lib/geld";
import type { LeadRoh, StufeZeile } from "@/lib/leads-board-bauen";
import { KASSE_ZAEHLER_CACHE_MS, kasseZaehlerCacheLeeren, ladeKasse, ladeKasseZaehler } from "./kasse";

const mocks = vi.hoisted(() => ({
  ladeLeadsRoh: vi.fn(),
  ladeZahlungsregel: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("@/services/leads-board", () => ({ ladeLeadsRoh: mocks.ladeLeadsRoh }));
vi.mock("@/services/company-settings", () => ({ ladeZahlungsregel: mocks.ladeZahlungsregel }));

/** Freitag, 06.11.2026, 12:00 Berlin. */
const JETZT = new Date("2026-11-06T11:00:00.000Z");

const STUFEN: StufeZeile[] = [
  { id: "s_neu", label: "Neue Anfrage", kategorie: "open_new", reihenfolge: 0, aktiv: true },
  { id: "s_angebot", label: "Angebot", kategorie: "quoted", reihenfolge: 2, aktiv: true },
  { id: "s_geplant", label: "Geplant", kategorie: "booked", reihenfolge: 3, aktiv: true },
  { id: "s_durch", label: "Durchgeführt", kategorie: "done_unpaid", reihenfolge: 4, aktiv: true },
  { id: "s_bezahlt", label: "Bezahlt", kategorie: "paid", reihenfolge: 5, aktiv: true },
  { id: "s_verloren", label: "Verloren", kategorie: "lost", reihenfolge: 6, aktiv: true },
];

const STAMM = {
  firmen: [
    { id: "f1", name: "Kottke", farbe: "#222224" },
    { id: "f2", name: "Ceylan", farbe: "#c9361a" },
  ],
  quellen: [],
  stufen: [],
  verlustGruende: [],
};

function rechnung(teil: Partial<RechnungKurz> = {}): RechnungKurz {
  return {
    id: "inv",
    nummer: "RE-1",
    status: "gestellt",
    bruttoCent: 100000,
    rechnungstag: "2026-10-01",
    faelligAm: "2026-11-20",
    abweichungGrund: null,
    erinnerung: null,
    ...teil,
  };
}

function lead(teil: Partial<LeadRoh> & Pick<LeadRoh, "id" | "stufeId">): LeadRoh {
  return {
    erstelltAm: "2026-10-01T10:00:00.000Z",
    nummer: null,
    name: teil.id,
    umzugAm: null,
    terminAuswahl: null,
    von: null,
    nach: null,
    firmaId: "f1",
    quelleId: null,
    wert: null,
    besichtigungAm: null,
    verlustGrund: null,
    wartet: null,
    angebot: null,
    optionen: [],
    annahme: null,
    portalZuletztGeoeffnet: null,
    versionen: { gesperrt: null, entwurf: null },
    rechner: null,
    rechnung: null,
    bezahltAm: null,
    stufeBetretenAm: null,
    barBeiTeam: [],
    anzahlungCent: null,
    fertigAm: null,
    dokumente: { kvErstesAm: null, rechnungAm: null, abAm: null },
    zahlungen: [],
    team: [],
    fotos: 0,
    telefone: [],
    meldungsEreignisse: [],
    letzteNachrichtAm: "2026-11-01T10:00:00.000Z",
    ...teil,
  };
}

const DEALS: LeadRoh[] = [
  lead({
    id: "m1",
    name: "Meldung",
    stufeId: "s_neu",
    meldungsEreignisse: [
      {
        id: "ev1",
        eventType: "customer.marked_paid",
        payload: { amountCents: 50000, variant: "final" },
        createdAt: "2026-11-02T10:00:00.000Z",
      },
    ],
  }),
  lead({
    id: "o1",
    name: "Ohne Rechnung",
    stufeId: "s_durch",
    umzugAm: "2026-11-05",
    angebot: {
      festpreisEuro: "1600.00",
      istStunden: false,
      serviceType: "move",
      mitEntruempelung: false,
      gueltigBis: null,
      selectedPackageOptionId: null,
      ohneVersion: true,
      versionGesendetAm: null,
      positionen: [],
    },
  }),
  lead({
    id: "r1",
    name: "Rest",
    stufeId: "s_durch",
    rechnung: rechnung({ id: "inv_r", bruttoCent: 200000, faelligAm: "2026-10-01" }),
    zahlungen: [{ amount: "500.00", taxTreatment: "betriebseinnahme", date: "2026-10-02" }],
  }),
  lead({
    id: "a1",
    name: "Anzahlung",
    stufeId: "s_geplant",
    firmaId: "f2",
    terminAuswahl: "2026-11-12",
    anzahlungCent: 30000,
  }),
  lead({
    id: "s1",
    name: "Stunden",
    stufeId: "s_angebot",
    angebot: {
      festpreisEuro: null,
      istStunden: true,
      serviceType: "move",
      mitEntruempelung: false,
      gueltigBis: null,
      selectedPackageOptionId: null,
      ohneVersion: true,
      versionGesendetAm: null,
      positionen: [],
    },
    rechnung: rechnung({ id: "inv_s", bruttoCent: null, faelligAm: null }),
  }),
  lead({
    id: "k1",
    name: "Kaution",
    stufeId: "s_bezahlt",
    rechnung: rechnung({ id: "inv_k", bruttoCent: 100000 }),
    zahlungen: [
      { amount: "200.00", taxTreatment: "betriebseinnahme", date: "2026-11-01" },
      { amount: "500.00", taxTreatment: "nicht_steuerbar", date: "2026-11-01" },
    ],
  }),
  lead({
    id: "t1",
    name: "Storno",
    stufeId: "s_bezahlt",
    rechnung: rechnung({ id: "inv_t", bruttoCent: 80000 }),
    zahlungen: [
      { amount: "400.00", taxTreatment: "betriebseinnahme", date: "2026-11-01" },
      { amount: "-400.00", taxTreatment: "betriebseinnahme", date: "2026-11-02" },
    ],
  }),
  lead({
    id: "l1",
    name: "Verloren",
    stufeId: "s_verloren",
    terminAuswahl: "2026-11-10",
    anzahlungCent: 40000,
    rechnung: rechnung({ id: "inv_l", bruttoCent: 90000, faelligAm: "2026-10-01" }),
    meldungsEreignisse: [
      {
        id: "ev_l",
        eventType: "customer.marked_paid",
        payload: { amountCents: 1000, variant: "deposit" },
        createdAt: "2026-11-01T10:00:00.000Z",
      },
    ],
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  kasseZaehlerCacheLeeren();
  mocks.ladeZahlungsregel.mockResolvedValue({ ...ZAHLUNGSREGEL_STANDARD });
  mocks.ladeLeadsRoh.mockResolvedValue({ eintraege: [], stamm: STAMM, stufen: STUFEN, roh: DEALS });
});

describe("ladeKasse", () => {
  it("füllt die vier Schlangen, lässt Verloren weg, zählt Kaution und Storno richtig", async () => {
    const k = await ladeKasse("ws_1", null, JETZT);

    expect(k.schlangen.meldung.map((z) => [z.dealId, z.betragCent])).toEqual([["m1", 50000]]);
    expect(k.schlangen.ohne_rechnung.map((z) => [z.dealId, z.betragCent])).toEqual([["o1", 160000]]);
    expect(k.schlangen.offen.map((z) => [z.dealId, z.betragCent, z.mahnreif])).toEqual([
      ["r1", 150000, true],
      ["k1", 80000, false],
      ["t1", 80000, false],
      ["s1", null, false],
    ]);
    expect(k.schlangen.anzahlung.map((z) => [z.dealId, z.betragCent, z.firmaName])).toEqual([["a1", 30000, "Ceylan"]]);
    expect(k.schlangen.meldung.some((z) => z.dealId === "l1")).toBe(false);
    expect(k.schlangen.offen.some((z) => z.dealId === "l1")).toBe(false);
    expect(k.summen.offen).toEqual({ anzahl: 4, cent: 150000 + 80000 + 80000, unbekannt: 1 });
    expect(mocks.ladeZahlungsregel).toHaveBeenCalledWith("ws_1", "f1");
    expect(mocks.ladeZahlungsregel).toHaveBeenCalledWith("ws_1", "f2");
    expect(mocks.ladeZahlungsregel).toHaveBeenCalledTimes(2);
  });

  it("filtert auf die Betriebsfirma", async () => {
    const k = await ladeKasse("ws_1", "f2", JETZT);
    expect(k.schlangen.anzahlung.map((z) => z.dealId)).toEqual(["a1"]);
    expect(k.schlangen.meldung).toEqual([]);
    expect(k.schlangen.ohne_rechnung).toEqual([]);
    expect(k.schlangen.offen).toEqual([]);
    expect(mocks.ladeZahlungsregel).toHaveBeenCalledTimes(1);
    expect(mocks.ladeZahlungsregel).toHaveBeenCalledWith("ws_1", "f2");
  });
});

describe("ladeKasseZaehler", () => {
  it("ist kasseZaehler der Kasse und 30 s je Workspace gemerkt", async () => {
    const direkt = await ladeKasse("ws_1", null, JETZT);
    expect(kasseZaehler(direkt)).toBe(4);

    expect(await ladeKasseZaehler("ws_1", JETZT)).toBe(4);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(2);

    expect(await ladeKasseZaehler("ws_1", new Date(JETZT.getTime() + KASSE_ZAEHLER_CACHE_MS - 1))).toBe(4);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(2);

    expect(await ladeKasseZaehler("ws_2", JETZT)).toBe(4);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(3);

    expect(await ladeKasseZaehler("ws_1", new Date(JETZT.getTime() + KASSE_ZAEHLER_CACHE_MS))).toBe(4);
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(4);

    kasseZaehlerCacheLeeren();
    mocks.ladeLeadsRoh.mockRejectedValueOnce(new Error("weg"));
    await expect(ladeKasseZaehler("ws_1", JETZT)).rejects.toThrow("weg");
    expect(await ladeKasseZaehler("ws_1", JETZT)).toBe(4);
  });
});
