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

import { chipsZaehlen } from "@/lib/leads-board-bauen";
import { PLAN_HEUTE, PLAN_JETZT, inboxEintrag, inboxListe, kalenderEreignis, leadEintrag } from "@/lib/plan-bauen.fixture";
import { HEUTE_VORSCHAU_TAGE, ladeHeute, ladeNavZaehler, liveLesen } from "./heute";

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
  mocks.ladeLeadsRoh.mockResolvedValue({ eintraege: LEADS, stamm: STAMM, stufen: [] });
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
  it("Heute = Chip „warten“ über alle Deals, Leads = offene Leads; keine eigene Abfrage", async () => {
    expect(await ladeNavZaehler("ws_1", PLAN_JETZT)).toEqual({ heute: 2, leads: 1 });
    expect(mocks.ladeLeadsRoh).toHaveBeenCalledWith("ws_1", PLAN_JETZT);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
