import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  listCalendarEvents: vi.fn(),
  ladeLeadsRoh: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/calendar/load-events", () => ({ listCalendarEvents: mocks.listCalendarEvents }));
vi.mock("@/services/leads-board", () => ({ ladeLeadsRoh: mocks.ladeLeadsRoh }));

import { LEERER_FILTER } from "@/lib/leads-board";
import { PLAN_HEUTE, PLAN_JETZT, kalenderEreignis, leadEintrag } from "@/lib/plan-bauen.fixture";
import type { PlanAbfrage } from "@/lib/plan-heute";
import type { CalendarEvent } from "@/services/calendar/map-events";
import { besichtigungFeldLesen, ladePlan, mitarbeiterLesen, teamIdsLesen, transporterLesen } from "./plan";

const dialect = new PgDialect();
const abfragen = () => mocks.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL));
const abfrageMit = (teil: string) => abfragen().find((q) => q.sql.includes(teil));

const ABFRAGE: PlanAbfrage = { von: "2026-11-02", bis: "2026-11-08", firmaId: null, mitarbeiterId: null, leads: null };

interface DbAntworten {
  team?: unknown[];
  transporter?: unknown[];
  mitarbeiter?: unknown[];
  felder?: unknown[];
}

function db(a: DbAntworten = {}) {
  mocks.execute.mockImplementation(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes("FROM deal_employees")) return a.team ?? [];
    if (text.includes("FROM objects ao")) return a.transporter ?? [];
    if (text.includes("FROM employees e")) return a.mitarbeiter ?? [];
    if (text.includes("FROM attributes a")) return a.felder ?? [];
    throw new Error(`unerwartete Abfrage: ${text}`);
  });
}

const STAMM = {
  firmen: [
    { id: "f_ceylan", name: "Ceylan Operations", farbe: "#c9361a" },
    { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" },
  ],
  quellen: [],
  stufen: [
    { id: "s_angebot", label: "Angebot", kategorie: "quoted" },
    { id: "s_geplant", label: "Geplant", kategorie: "booked" },
    { id: "s_durch", label: "Durchgeführt", kategorie: "done_unpaid" },
  ],
  verlustGruende: [],
};

const LEADS = [
  leadEintrag({ id: "d1", name: "Familie Weber" }, ["warten"]),
  leadEintrag({ id: "d2", name: "Vogel", teamFehlt: true, firma: { id: "f_ceylan", name: "Ceylan Operations", farbe: "#c9361a" } }, ["ohne_team"]),
  leadEintrag({ id: "d3", name: "Nowak", stufe: { id: "s_angebot", label: "Angebot", kategorie: "quoted" } }),
  leadEintrag({ id: "d_lost", name: "Weg", stufe: { id: "s_lost", label: "Abgesagt", kategorie: "lost" } }),
];

const EVENTS: CalendarEvent[] = [
  kalenderEreignis({ dealId: "d2", id: "move:d2", date: "2026-11-05", endDate: "2026-11-05", startTime: null, endTime: null, allDay: true }),
  kalenderEreignis({ dealId: "d1", id: "move:d1", date: "2026-11-05", endDate: "2026-11-05" }),
  kalenderEreignis({ dealId: "d3", id: "move:d3", date: "2026-11-07", endDate: "2026-11-07", estimated: true, dateSource: "proposal" }),
  kalenderEreignis({
    dealId: "d3",
    id: "appt:besichtigung_am:d3",
    kind: "appointment",
    appointmentLabel: "Besichtigung",
    date: "2026-11-06",
    endDate: "2026-11-06",
    startTime: "16:00",
    endTime: "18:00",
    dateSource: "appointment",
  }),
  kalenderEreignis({ dealId: "d_lost", id: "move:d_lost", date: "2026-11-06", endDate: "2026-11-06" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCalendarEvents.mockResolvedValue({ events: EVENTS, companies: [], stages: [], from: ABFRAGE.von, to: ABFRAGE.bis });
  mocks.ladeLeadsRoh.mockResolvedValue({ eintraege: LEADS, stamm: STAMM, stufen: [] });
  db();
});

describe("ladePlan", () => {
  it("Kalender nur offen und mit Slot-Korrektur, Einträge sortiert, Verloren fehlt, Stammdaten", async () => {
    db({
      transporter: [{ deal_id: "d1", transporter: "Mercedes Sprinter lang" }],
      mitarbeiter: [
        { id: "e2", name: "Ali Bulut" },
        { id: "e1", name: "Max Kottke" },
      ],
      felder: [
        { slug: "termin_kunde", title: "Termin", typ: "date" },
        { slug: "besichtigung_am", title: "Besichtigung am", typ: "timestamp" },
      ],
    });
    const p = await ladePlan("ws_1", ABFRAGE, PLAN_JETZT);

    expect(mocks.listCalendarEvents).toHaveBeenCalledWith(
      "ws_1",
      { from: "2026-11-02", to: "2026-11-08", companyIds: [], stageIds: [], includeClosed: false },
      { slotOnlyOnSameDay: true },
    );
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledWith("ws_1", PLAN_JETZT);
    expect(p.eintraege.map((e) => [e.id, e.ton, e.titel])).toEqual([
      ["move:d1", "gold", "Familie Weber"],
      ["move:d2", "gold", "Vogel"],
      ["appt:besichtigung_am:d3", "violett", "Besichtigung Nowak"],
      ["move:d3", "gestrichelt", "Nowak?"],
    ]);
    expect(p.eintraege[0]).toMatchObject({ transporter: "Mercedes Sprinter lang", fehlt: ["bestaetigen"], href: "/app/leads/d1" });
    expect(p.eintraege[1].fehlt).toEqual(["bestaetigen", "team"]);
    expect(p.imBlick.map((c) => c.key)).toEqual(["bestaetigen:move:d1", "bestaetigen:move:d2", "nicht_fest"]);
    expect(p).toMatchObject({
      von: "2026-11-02",
      bis: "2026-11-08",
      heute: PLAN_HEUTE,
      firmen: STAMM.firmen,
      stufen: STAMM.stufen,
      mitarbeiter: [
        { id: "e2", name: "Ali Bulut", kuerzel: "AB" },
        { id: "e1", name: "Max Kottke", kuerzel: "MK" },
      ],
      besichtigungFeld: { slug: "besichtigung_am", typ: "timestamp" },
      stand: PLAN_JETZT.toISOString(),
    });
    // Ohne Mitarbeiter-Filter keine Team-Abfrage.
    expect(abfrageMit("FROM deal_employees")).toBeUndefined();
    // Fahrzeug nur für Umzugs-Deals.
    expect(abfrageMit("FROM objects ao")?.params).toEqual(expect.arrayContaining(["d1", "d2", "d3"]));
    expect(abfrageMit("FROM objects ao")?.params).not.toContain("d_lost");
  });

  it("Firma filtert (ohne Firma fällt heraus)", async () => {
    const p = await ladePlan("ws_1", { ...ABFRAGE, firmaId: "f_ceylan" }, PLAN_JETZT);
    expect(p.eintraege.map((e) => e.id)).toEqual(["move:d2"]);
  });

  it("Mitarbeiter: nur Deals mit dieser Person im Team", async () => {
    db({ team: [{ deal_id: "d1", mitarbeiter_id: "e1" }, { deal_id: "d3", mitarbeiter_id: "e1" }, { deal_id: "d2", mitarbeiter_id: "e2" }] });
    const p = await ladePlan("ws_1", { ...ABFRAGE, mitarbeiterId: "e1" }, PLAN_JETZT);
    expect(p.eintraege.map((e) => e.id)).toEqual(["move:d1", "appt:besichtigung_am:d3", "move:d3"]);
    const q = abfrageMit("FROM deal_employees");
    expect(q?.params).toEqual(expect.arrayContaining(["d1", "d2", "d3"]));
  });

  it("Leads-Kalender: Leads-Filter ohne Monat, Besichtigungen der übrigen Deals bleiben", async () => {
    const chip = await ladePlan("ws_1", { ...ABFRAGE, leads: { ...LEERER_FILTER, chip: "ohne_team" } }, PLAN_JETZT);
    expect(chip.eintraege.map((e) => e.id)).toEqual(["move:d2"]);
    const suche = await ladePlan("ws_1", { ...ABFRAGE, leads: { ...LEERER_FILTER, suche: "nowak", monat: "2027-01" } }, PLAN_JETZT);
    expect(suche.eintraege.map((e) => e.id)).toEqual(["appt:besichtigung_am:d3", "move:d3"]);
    const mitMa = await (async () => {
      db({ team: [{ deal_id: "d1", mitarbeiter_id: "e1" }, { deal_id: "d2", mitarbeiter_id: "e1" }] });
      return ladePlan("ws_1", { ...ABFRAGE, mitarbeiterId: "e1", leads: { ...LEERER_FILTER, chip: "warten" } }, PLAN_JETZT);
    })();
    expect(mitMa.eintraege.map((e) => e.id)).toEqual(["move:d1"]);
  });

  it("vorgeladene Leads (auch als Versprechen) ersetzen ladeLeadsRoh", async () => {
    await ladePlan("ws_1", ABFRAGE, PLAN_JETZT, Promise.resolve({ eintraege: LEADS, stamm: STAMM, stufen: [] }) as never);
    expect(mocks.ladeLeadsRoh).not.toHaveBeenCalled();
  });

  it("leeres Fenster: keine Fahrzeug- und keine Team-Abfrage", async () => {
    mocks.listCalendarEvents.mockResolvedValue({ events: [], companies: [], stages: [], from: ABFRAGE.von, to: ABFRAGE.bis });
    const p = await ladePlan("ws_1", { ...ABFRAGE, mitarbeiterId: "e1" }, PLAN_JETZT);
    expect([p.eintraege, p.imBlick]).toEqual([[], []]);
    expect(abfrageMit("FROM objects ao")).toBeUndefined();
    expect(abfrageMit("FROM deal_employees")).toBeUndefined();
  });
});

describe("Abfragen", () => {
  /** Jede Tabelle mit workspace_id: jeder Alias hat `alias.workspace_id = $n` mit ws_1. */
  function workspaceGrenze(q: { sql: string; params: unknown[] }, tabellen: string[]) {
    for (const tabelle of tabellen) {
      const aliase = [...q.sql.matchAll(new RegExp(`(?:FROM|JOIN)\\s+${tabelle}\\s+(\\w+)`, "g"))].map((m) => m[1]);
      expect(aliase.length, tabelle).toBeGreaterThan(0);
      for (const alias of aliase) {
        const treffer = [...q.sql.matchAll(new RegExp(`\\b${alias}\\.workspace_id = \\$(\\d+)`, "g"))];
        expect(treffer.length, `${tabelle} ${alias}`).toBeGreaterThan(0);
        for (const t of treffer) expect(q.params[Number(t[1]) - 1], `${tabelle} ${alias}`).toBe("ws_1");
      }
    }
  }

  function sauber(q: { sql: string }) {
    expect(q.sql).not.toMatch(/file_content|rechner_result|\bresult\b|photo_base64/);
    expect(q.sql).not.toMatch(/\bSELECT \*|\.\*/);
  }

  it("Team-IDs: Mitarbeiter und Deals des Workspace, lebende Deals, leere Liste ohne Abfrage", async () => {
    expect(await teamIdsLesen("ws_1", [])).toEqual(new Map());
    expect(mocks.execute).not.toHaveBeenCalled();
    db({ team: [{ deal_id: "d1", mitarbeiter_id: "e1" }, { deal_id: "d1", mitarbeiter_id: "e1" }, { deal_id: "d1", mitarbeiter_id: "e2" }] });
    expect(await teamIdsLesen("ws_1", ["d1", "d2"])).toEqual(new Map([["d1", ["e1", "e2"]]]));
    const q = abfragen()[0];
    workspaceGrenze(q, ["employees", "objects"]);
    expect(q.sql).toMatch(/INNER JOIN records r ON r\.id = de\.deal_record_id AND r\.deleted_at IS NULL/);
    expect(q.sql).toMatch(/o\.id = r\.object_id AND o\.workspace_id = \$\d+ AND o\.slug = 'deals'/);
    expect(q.sql).toMatch(/de\.deal_record_id = ANY\(ARRAY\[\$\d+, \$\d+\]::text\[\]\)/);
    sauber(q);
  });

  it("Fahrzeug: Auftrag und Deal je über ein Objekt des Workspace, lebende Datensätze, Optionstitel", async () => {
    expect(await transporterLesen("ws_1", [])).toEqual(new Map());
    expect(mocks.execute).not.toHaveBeenCalled();
    db({ transporter: [{ deal_id: "d1", transporter: " Peugeot Boxer 3,5 t " }, { deal_id: "d2", transporter: "" }] });
    expect(await transporterLesen("ws_1", ["d1", "d2"])).toEqual(new Map([["d1", "Peugeot Boxer 3,5 t"]]));
    const q = abfragen()[0];
    workspaceGrenze(q, ["objects"]);
    expect(q.sql).toMatch(/ao\.workspace_id = \$\d+ AND ao\.slug = 'auftraege'/);
    expect(q.sql).toMatch(/od\.workspace_id = \$\d+ AND od\.slug = 'deals'/);
    expect(q.sql).toMatch(/ra\.object_id = ao\.id AND ra\.deleted_at IS NULL/);
    expect(q.sql).toMatch(/rdeal\.deleted_at IS NULL/);
    expect(q.sql).toMatch(/so\.attribute_id = a_tr\.id/);
    sauber(q);
  });

  it("Mitarbeiter: nur dieser Workspace, ohne Foto", async () => {
    db({ mitarbeiter: [{ id: "e1", name: "  " }] });
    expect(await mitarbeiterLesen("ws_1")).toEqual([{ id: "e1", name: "Ohne Namen", kuerzel: "ON" }]);
    const q = abfragen()[0];
    workspaceGrenze(q, ["employees"]);
    expect(q.params).toEqual(["ws_1"]);
    sauber(q);
  });

  it("Besichtigungsfeld: nur Deal-Attribute des Workspace; besichtigung_am bevorzugt, sonst erstes passendes, sonst null", async () => {
    db({ felder: [{ slug: "move_date", title: "Umzugsdatum", typ: "date" }] });
    expect(await besichtigungFeldLesen("ws_1")).toBeNull();
    const q = abfragen()[0];
    workspaceGrenze(q, ["objects"]);
    expect(q.sql).toMatch(/o\.slug = 'deals'/);
    expect(q.sql).toMatch(/a\.type IN \('date', 'timestamp'\)/);
    sauber(q);

    db({
      felder: [
        { slug: "termin_vor_ort", title: "Ortstermin", typ: "timestamp" },
        { slug: "besichtigung_datum", title: "Besichtigung", typ: "date" },
        { slug: "besichtigung_am", title: "Besichtigung am", typ: "timestamp" },
      ],
    });
    expect(await besichtigungFeldLesen("ws_1")).toEqual({ slug: "besichtigung_am", typ: "timestamp" });
    db({ felder: [{ slug: "viewing", title: "Besichtigungstermin", typ: "date" }] });
    expect(await besichtigungFeldLesen("ws_1")).toEqual({ slug: "viewing", typ: "date" });
    // Ein Feld, das der Kalender ignoriert, zählt nicht (sonst stünde der Eintrag nicht im Plan).
    db({ felder: [{ slug: "besichtigung_reminder", title: "Besichtigung Erinnerung", typ: "date" }] });
    expect(await besichtigungFeldLesen("ws_1")).toBeNull();
  });
});
