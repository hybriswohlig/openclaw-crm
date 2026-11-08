import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  listCalendarEvents: vi.fn(),
  ladeLeadsRoh: vi.fn(),
  ladeInboxListe: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/calendar/load-events", () => ({ listCalendarEvents: mocks.listCalendarEvents }));
vi.mock("@/services/leads-board", () => ({ ladeLeadsRoh: mocks.ladeLeadsRoh }));
vi.mock("@/services/inbox-neu", () => ({ ladeInboxListe: mocks.ladeInboxListe }));

import type { RechnungKurz } from "@/lib/geld";
import { chipsZaehlen, type LeadRoh, type StufeZeile } from "@/lib/leads-board-bauen";
import { PLAN_HEUTE, PLAN_JETZT, inboxEintrag, inboxListe, kalenderEreignis, leadEintrag } from "@/lib/plan-bauen.fixture";
import { kasseZaehlerCacheLeeren } from "./kasse";
import { HEUTE_VORSCHAU_TAGE, ladeHeute, ladeNavZaehler, liveLesen, navZaehlerCacheLeeren } from "./heute";

const dialect = new PgDialect();
const abfragen = () => mocks.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL));
const abfrageMit = (teil: string) => abfragen().find((q) => q.sql.includes(teil));

const LEADS = [
  leadEintrag({ id: "d1", name: "Familie Weber" }, ["warten", "diese_woche"]),
  leadEintrag({ id: "d2", name: "Vogel", zahlungGemeldet: "Kunde meldet bezahlt · 500 €" }, ["warten"]),
  leadEintrag({ id: "d3", name: "Nowak", stufe: { id: "s_neu", label: "Neue Anfrage", kategorie: "open_new" } }),
];
const STAMM = { firmen: [], quellen: [], stufen: [], verlustGruende: [] };
const INBOX = inboxListe([inboxEintrag({ ungelesen: 1, kiEntwurf: { text: "KI-Entwurf" } })]);

function db(live: unknown[] = []) {
  mocks.execute.mockImplementation(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes("FROM move_time_entries")) return live;
    if (text.includes("FROM objects ao")) return [];
    throw new Error(`unerwartete Abfrage: ${text}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  navZaehlerCacheLeeren();
  kasseZaehlerCacheLeeren();
  mocks.ladeLeadsRoh.mockResolvedValue({ eintraege: LEADS, stamm: STAMM, stufen: [], roh: [] });
  mocks.ladeInboxListe.mockResolvedValue(INBOX);
  mocks.listCalendarEvents.mockResolvedValue({
    events: [
      kalenderEreignis({ dealId: "d1", id: "move:d1", date: PLAN_HEUTE, endDate: PLAN_HEUTE }),
      kalenderEreignis({
        dealId: "d3",
        id: "appt:besichtigung_am:d3",
        kind: "appointment",
        appointmentLabel: "Besichtigung",
        date: PLAN_HEUTE,
        endDate: PLAN_HEUTE,
        startTime: "16:00",
        endTime: "18:00",
        dateSource: "appointment",
      }),
      kalenderEreignis({ dealId: "d2", id: "move:d2", date: "2026-11-07", endDate: "2026-11-07" }),
    ],
    companies: [],
    stages: [],
    from: PLAN_HEUTE,
    to: "2026-11-20",
  });
  db();
});

describe("ladeHeute", () => {
  it("einmal Leads, Plan heute bis heute+14 mit Slot-Korrektur, Inbox, Live nur für heutige Umzüge", async () => {
    db([{ deal_id: "d1", los_am: "2026-11-06 06:12:00", vor_ort_am: null, fertig_am: null }]);
    const h = await ladeHeute("ws_1", PLAN_JETZT);

    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(1);
    expect(mocks.listCalendarEvents).toHaveBeenCalledWith(
      "ws_1",
      { from: PLAN_HEUTE, to: "2026-11-20", companyIds: [], stageIds: [], includeClosed: false },
      { slotOnlyOnSameDay: true },
    );
    expect(HEUTE_VORSCHAU_TAGE).toBe(14);
    expect(mocks.ladeInboxListe).toHaveBeenCalledWith("ws_1", { jetzt: PLAN_JETZT });

    const live = abfrageMit("FROM move_time_entries");
    expect(live?.params.filter((p) => p !== "ws_1")).toEqual(["d1"]);

    expect(h.tag).toBe(PLAN_HEUTE);
    expect(h.heute.map((t) => [t.id, t.live])).toEqual([
      ["move:d1", { losAm: "2026-11-06T06:12:00.000Z", vorOrtAm: null, fertigAm: null }],
      ["appt:besichtigung_am:d3", null],
    ]);
    expect(h.morgen.map((t) => t.id)).toEqual(["move:d2"]);
    expect(h.naechster).toBeNull();
    expect(h.chips).toEqual(chipsZaehlen(LEADS));
    expect(h.inbox).toEqual(INBOX.chips);
    expect(h.meldungen).toEqual([{ dealId: "d2", name: "Vogel", text: "Kunde meldet bezahlt · 500 €", href: "/app/leads/d2" }]);
    expect(h.meldungenGesamt).toBe(1);
    expect(h.freigaben).toEqual([{ key: "deal:d1", name: "Familie Weber", text: "KI-Entwurf", href: "/app/inbox?e=deal%3Ad1" }]);
    expect(h.tagesabschluss).toEqual([]);
  });

  it("ohne Umzug heute keine Live-Abfrage", async () => {
    mocks.listCalendarEvents.mockResolvedValue({ events: [], companies: [], stages: [], from: PLAN_HEUTE, to: "2026-11-20" });
    const h = await ladeHeute("ws_1", PLAN_JETZT);
    expect(abfrageMit("FROM move_time_entries")).toBeUndefined();
    expect([h.heute, h.morgen, h.naechster]).toEqual([[], [], null]);
  });
});

describe("liveLesen", () => {
  it("Workspace-Spalte und Deal-Scope des Workspace, lebende Deals; leere Liste ohne Abfrage", async () => {
    expect(await liveLesen("ws_1", [])).toEqual(new Map());
    expect(mocks.execute).not.toHaveBeenCalled();

    db([{ deal_id: "d1", los_am: null, vor_ort_am: "2026-11-06 07:05:00", fertig_am: null }]);
    expect(await liveLesen("ws_1", ["d1", "d9"])).toEqual(
      new Map([["d1", { losAm: null, vorOrtAm: "2026-11-06T07:05:00.000Z", fertigAm: null }]]),
    );
    const q = abfragen()[0];
    const m = /WHERE m\.workspace_id = \$(\d+)/.exec(q.sql);
    expect(m).not.toBeNull();
    expect(q.params[Number(m![1]) - 1]).toBe("ws_1");
    const o = /o\.id = r\.object_id AND o\.workspace_id = \$(\d+) AND o\.slug = 'deals'/.exec(q.sql);
    expect(o).not.toBeNull();
    expect(q.params[Number(o![1]) - 1]).toBe("ws_1");
    expect(q.sql).toMatch(/INNER JOIN records r ON r\.id = m\.deal_record_id AND r\.deleted_at IS NULL/);
    expect(q.sql).toMatch(/m\.deal_record_id = ANY\(ARRAY\[\$\d+, \$\d+\]::text\[\]\)/);
    expect(q.sql).not.toMatch(/\bSELECT \*|\.\*|file_content|rechner_result/);
  });
});

describe("ladeNavZaehler", () => {
  it("Heute und Leads aus der Zählabfrage, Kasse über ladeKasseZaehler", async () => {
    mocks.execute.mockResolvedValueOnce([{ stufe_id: "s_neu", titel: "Neue Anfrage", kategorie: "open_new", anzahl: "3", warten: "2" }]);
    expect(await ladeNavZaehler("ws_1", PLAN_JETZT)).toEqual({ heute: 2, leads: 3, kasse: 0 });
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});

const GELD_STUFEN: StufeZeile[] = [
  { id: "s_geplant", label: "Geplant", kategorie: "booked", reihenfolge: 3, aktiv: true },
  { id: "s_durch", label: "Durchgeführt", kategorie: "done_unpaid", reihenfolge: 4, aktiv: true },
  { id: "s_bezahlt", label: "Bezahlt", kategorie: "paid", reihenfolge: 5, aktiv: true },
];

const GESTELLT: RechnungKurz = {
  id: "inv_1",
  nummer: "RE-1",
  status: "gestellt",
  bruttoCent: 100000,
  rechnungstag: "2026-11-05",
  faelligAm: "2026-11-05",
  abweichungGrund: null,
  erinnerung: null,
};

function leadRoh(teil: Partial<LeadRoh> & Pick<LeadRoh, "id">): LeadRoh {
  return {
    erstelltAm: "2026-10-01T10:00:00.000Z",
    nummer: null,
    name: teil.id,
    stufeId: null,
    umzugAm: null,
    terminAuswahl: null,
    von: null,
    nach: null,
    firmaId: null,
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
    letzteNachrichtAm: null,
    ...teil,
  };
}

describe("Tagesabschluss auf Heute", () => {
  it("fertig vor dem Umzugstag, gestern, ohne Rechnung, nur Bar; erledigt ohne Karte", async () => {
    mocks.ladeLeadsRoh.mockResolvedValue({
      eintraege: [],
      stamm: STAMM,
      stufen: GELD_STUFEN,
      roh: [
        // Fix-Welle I2: „fertig“ vor dem letzten Umzugstag zählt nicht.
        leadRoh({ id: "fertig", stufeId: "s_geplant", umzugAm: "2026-11-08", fertigAm: "2026-11-06T08:10:00.000Z" }),
        leadRoh({ id: "gestern", stufeId: "s_geplant", umzugAm: "2026-11-05" }),
        leadRoh({ id: "durch", stufeId: "s_durch", umzugAm: "2026-11-04" }),
        leadRoh({
          id: "bar",
          stufeId: "s_bezahlt",
          rechnung: GESTELLT,
          barBeiTeam: [{ paymentId: "pay_1", mitarbeiter: "Hans", cent: 45000 }],
        }),
        leadRoh({ id: "erledigt", stufeId: "s_bezahlt", umzugAm: "2026-11-05", rechnung: GESTELLT }),
      ],
    });
    const karten = (await ladeHeute("ws_1", PLAN_JETZT)).tagesabschluss;
    expect(karten.map((k) => k.dealId)).toEqual(["durch", "gestern", "bar"]);
    expect(karten[1].letzterTermintag).toBe("2026-11-05");

    const durch = karten[0];
    expect(durch.hinweis).toBe("Termin war 04.11.2026");
    expect(durch.schritte.map((s) => [s.art, s.status])).toEqual([
      ["bestaetigen", "erledigt"],
      ["rechnung", "jetzt"],
    ]);

    const gestern = karten[1];
    expect(gestern.hinweis).toBe("Termin war 05.11.2026");
    expect(gestern.schritte.map((s) => [s.art, s.status])).toEqual([
      ["bestaetigen", "jetzt"],
      ["rechnung", "spaeter"],
    ]);

    const bar = karten[2];
    expect(bar.hinweis).toBe("Bargeld beim Team");
    expect(bar.schritte.map((s) => [s.art, s.status])).toEqual([
      ["bestaetigen", "erledigt"],
      ["rechnung", "erledigt"],
      ["bar", "jetzt"],
    ]);
    expect(bar.schritte[2].text).toMatch(/Bar bei Hans: 450,00\s*€/);
    expect(bar.schritte[2].paymentIds).toEqual(["pay_1"]);
  });

  it("mehrtägiger Umzug: erst nach dem letzten Tag, „fertig“ nur am letzten Tag (Fix-Welle I2)", async () => {
    mocks.ladeLeadsRoh.mockResolvedValue({
      eintraege: [],
      stamm: STAMM,
      stufen: GELD_STUFEN,
      roh: [
        // Start gestern, Ende morgen: läuft noch, auch wenn gestern „fertig“ gemeldet wurde.
        leadRoh({ id: "laeuft", stufeId: "s_geplant", umzugAm: "2026-11-05", umzugEnde: "2026-11-07", fertigAm: "2026-11-05T15:00:00.000Z" }),
        // Start vorgestern, Ende heute, „fertig“ heute: Karte mit Hinweis.
        leadRoh({ id: "heute_fertig", stufeId: "s_geplant", umzugAm: "2026-11-04", umzugEnde: "2026-11-06", fertigAm: "2026-11-06T13:10:00.000Z" }),
        // Ende gestern: Termin war.
        leadRoh({ id: "vorbei", stufeId: "s_geplant", umzugAm: "2026-11-03", umzugEnde: "2026-11-05" }),
      ],
    });
    const karten = (await ladeHeute("ws_1", PLAN_JETZT)).tagesabschluss;
    expect(karten.map((k) => k.dealId).sort()).toEqual(["heute_fertig", "vorbei"]);
    expect(karten.find((k) => k.dealId === "heute_fertig")?.hinweis).toBe("Team meldet fertig 14:10");
    expect(karten.find((k) => k.dealId === "vorbei")?.hinweis).toBe("Termin war 05.11.2026");
  });
});
