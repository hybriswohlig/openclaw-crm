import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Abwesenheit, EinsatzPerson } from "@/lib/einsatz";
import type { PlanEintrag } from "@/lib/plan-heute";
import { kalenderEreignis, leadEintrag } from "@/lib/plan-bauen.fixture";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ladePersonen: vi.fn(),
  ladeAbwesenheiten: vi.fn(),
  listCalendarEvents: vi.fn(),
  ladeLeadsRoh: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/einsatz-personen", () => ({
  ladePersonen: mocks.ladePersonen,
  ladeAbwesenheiten: mocks.ladeAbwesenheiten,
}));
vi.mock("@/services/calendar/load-events", () => ({ listCalendarEvents: mocks.listCalendarEvents }));
vi.mock("@/services/leads-board", () => ({ ladeLeadsRoh: mocks.ladeLeadsRoh }));

import { kapazitaetFuer, ladePlan } from "./plan";

const dialect = new PgDialect();

function person(id: string, name: string, aktiv = true): EinsatzPerson {
  return {
    id,
    name,
    kuerzel: name.slice(0, 2).toUpperCase(),
    aktiv,
    plz: null,
    wohnort: null,
    kannSprinter: false,
    eigenerPkw: false,
    satzFahrtCent: 1500,
    satzArbeitCent: 2000,
  };
}

function eintrag(e: Pick<PlanEintrag, "dealId" | "art" | "ton" | "tag" | "bisTag" | "titel">): PlanEintrag {
  return e as PlanEintrag;
}

const PERSONEN = [person("e1", "Ali"), person("e2", "Bea", false), person("e3", "Cem")];
const ABWESENHEITEN: Abwesenheit[] = [
  { id: "a1", employeeId: "e1", von: "2026-10-31", bis: "2026-11-02", art: "urlaub", notiz: null },
];

/** Teams auch für nicht feste Einträge: die Kapazität darf sie trotzdem nicht belegen. */
const TEAM = [
  { deal_id: "d_multi", mitarbeiter_id: "e1" },
  { deal_id: "d_multi", mitarbeiter_id: "e3" },
  { deal_id: "d_multi", mitarbeiter_id: "e2" },
  { deal_id: "d_andere", mitarbeiter_id: "e3" },
  { deal_id: "d_strich", mitarbeiter_id: "e3" },
  { deal_id: "d_violett", mitarbeiter_id: "e3" },
  { deal_id: "d_grau", mitarbeiter_id: "e3" },
];

const ALLE = [
  eintrag({ dealId: "d_strich", art: "umzug", ton: "gestrichelt", tag: "2026-11-04", bisTag: "2026-11-04", titel: "Wunsch?" }),
  eintrag({ dealId: "d_violett", art: "besichtigung", ton: "violett", tag: "2026-11-04", bisTag: "2026-11-04", titel: "Besichtigung" }),
  eintrag({ dealId: "d_grau", art: "umzug", ton: "grau", tag: "2026-11-04", bisTag: "2026-11-04", titel: "Erledigt" }),
  eintrag({ dealId: "d_multi", art: "umzug", ton: "jade", tag: "2026-11-02", bisTag: "2026-11-03", titel: "Mehrtägig" }),
  eintrag({ dealId: "d_andere", art: "umzug", ton: "gold", tag: "2026-11-01", bisTag: "2026-11-01", titel: "Andere Firma" }),
];

const VON = "2026-11-01";
const BIS = "2026-11-04";

function tag(liste: { tag: string }[], datum: string) {
  const k = liste.find((x) => x.tag === datum);
  if (!k) throw new Error(`Tag ${datum} fehlt`);
  return k as {
    tag: string;
    text: string;
    ton: string;
    freiZahl: number;
    frei: { id: string; name: string }[];
    belegt: { person: { id: string }; deals: { dealId: string; titel: string }[] }[];
    abwesend: { person: { id: string }; art: string }[];
  };
}

function festeIds(aufrufe = mocks.execute.mock.calls): string[][] {
  return aufrufe
    .map((c) => dialect.sqlToQuery(c[0] as SQL))
    .filter((q) => q.sql.includes("FROM deal_employees"))
    .map((q) => q.params.filter((p) => p !== "ws_1") as string[]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue(TEAM);
  mocks.ladePersonen.mockResolvedValue(PERSONEN);
  mocks.ladeAbwesenheiten.mockResolvedValue(ABWESENHEITEN);
});

describe("kapazitaetFuer", () => {
  it("zählt nur feste Umzüge, inaktive nie, mehrtägig jeden Tag, Abwesenheit über den Monat, ohneDeal fehlt", async () => {
    const { einsaetze, kapazitaet } = await kapazitaetFuer("ws_1", VON, BIS, ALLE);

    expect(festeIds()).toEqual([["d_multi", "d_andere"]]);
    expect(mocks.ladePersonen).toHaveBeenCalledWith("ws_1");
    expect(mocks.ladeAbwesenheiten).toHaveBeenCalledWith("ws_1", VON, BIS);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(einsaetze.map((e) => e.dealId)).toEqual(["d_multi", "d_andere"]);
    expect(kapazitaet.map((k) => k.tag)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);

    const personenIds = kapazitaet.flatMap((k) => [
      ...k.frei.map((p) => p.id),
      ...k.belegt.map((b) => b.person.id),
      ...k.abwesend.map((a) => a.person.id),
    ]);
    expect(personenIds).not.toContain("e2");

    expect(tag(kapazitaet, "2026-11-01")).toMatchObject({
      text: "0 frei",
      ton: "rot",
      frei: [],
      belegt: [{ person: { id: "e3" }, deals: [{ dealId: "d_andere", titel: "Andere Firma" }] }],
      abwesend: [{ person: { id: "e1" }, art: "urlaub" }],
    });
    expect(tag(kapazitaet, "2026-11-02").belegt.map((b) => [b.person.id, b.deals.map((d) => d.dealId)])).toEqual([
      ["e1", ["d_multi"]],
      ["e3", ["d_multi"]],
    ]);
    expect(tag(kapazitaet, "2026-11-02").abwesend.map((a) => a.person.id)).toEqual(["e1"]);
    expect(tag(kapazitaet, "2026-11-03")).toMatchObject({
      text: "0 frei",
      ton: "rot",
      abwesend: [],
      belegt: [{ person: { id: "e1" } }, { person: { id: "e3" } }],
    });
    expect(tag(kapazitaet, "2026-11-03").belegt.every((b) => b.deals[0]?.dealId === "d_multi")).toBe(true);
    expect(tag(kapazitaet, "2026-11-04")).toMatchObject({
      text: "2 frei",
      ton: "gruen",
      frei: [{ id: "e1", name: "Ali" }, { id: "e3", name: "Cem" }],
      belegt: [],
      abwesend: [],
    });

    const ohne = await kapazitaetFuer("ws_1", VON, BIS, ALLE, "d_multi");
    expect(ohne.einsaetze.map((e) => e.dealId)).toEqual(["d_andere"]);
    expect(festeIds()).toEqual([
      ["d_multi", "d_andere"],
      ["d_multi", "d_andere"],
    ]);
    expect(tag(ohne.kapazitaet, "2026-11-02")).toMatchObject({
      text: "1 frei",
      ton: "gold",
      frei: [{ id: "e3" }],
      belegt: [],
      abwesend: [{ person: { id: "e1" }, art: "urlaub" }],
    });
    expect(tag(ohne.kapazitaet, "2026-11-03").frei.map((p) => p.id)).toEqual(["e1", "e3"]);
    expect(tag(ohne.kapazitaet, "2026-11-01").belegt.map((b) => b.deals[0]?.dealId)).toEqual(["d_andere"]);
    expect(tag(ohne.kapazitaet, "2026-11-04").frei.map((p) => p.id)).toEqual(["e1", "e3"]);
  });

  it("Firmenfilter ändert die Kapazität nicht; ein KapazitaetTag je Fenster-Tag", async () => {
    const KOTTKE = { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" };
    const CEYLAN = { id: "f_ceylan", name: "Ceylan Operations", farbe: "#c9361a" };
    const leads = [
      leadEintrag({ id: "d_multi", name: "Mehrtägig", firma: KOTTKE }),
      leadEintrag({ id: "d_andere", name: "Andere Firma", teamFehlt: true, firma: CEYLAN }),
      leadEintrag({
        id: "d_strich",
        name: "Wunsch",
        firma: KOTTKE,
        stufe: { id: "s_angebot", label: "Angebot", kategorie: "quoted" },
      }),
      leadEintrag({ id: "d_violett", name: "Meier", firma: KOTTKE }),
      leadEintrag({
        id: "d_grau",
        name: "Erledigt",
        firma: KOTTKE,
        stufe: { id: "s_durch", label: "Durchgeführt", kategorie: "done_unpaid" },
      }),
    ];
    const events = [
      kalenderEreignis({ dealId: "d_andere", id: "move:d_andere", date: "2026-11-01", endDate: "2026-11-01", companyId: "f_ceylan" }),
      kalenderEreignis({ dealId: "d_multi", id: "move:d_multi", date: "2026-11-02", endDate: "2026-11-03", companyId: "f_kottke" }),
      kalenderEreignis({
        dealId: "d_strich",
        id: "move:d_strich",
        date: "2026-11-04",
        endDate: "2026-11-04",
        estimated: true,
        dateSource: "proposal",
        companyId: "f_kottke",
      }),
      kalenderEreignis({
        dealId: "d_violett",
        id: "appt:besichtigung_am:d_violett",
        kind: "appointment",
        appointmentLabel: "Besichtigung",
        date: "2026-11-04",
        endDate: "2026-11-04",
        startTime: "16:00",
        endTime: "17:00",
        dateSource: "appointment",
        companyId: "f_kottke",
      }),
      kalenderEreignis({ dealId: "d_grau", id: "move:d_grau", date: "2026-11-04", endDate: "2026-11-04", companyId: "f_kottke" }),
    ];
    mocks.listCalendarEvents.mockResolvedValue({ events, companies: [], stages: [], from: VON, to: BIS });
    mocks.ladeLeadsRoh.mockResolvedValue({
      eintraege: leads,
      stamm: { firmen: [KOTTKE, CEYLAN], quellen: [], stufen: [], verlustGruende: [] },
      stufen: [],
    });
    mocks.execute.mockImplementation(async (q: SQL) => {
      const text = dialect.sqlToQuery(q).sql;
      if (text.includes("FROM deal_employees")) return TEAM;
      return [];
    });

    const abfrage = { von: VON, bis: BIS, firmaId: null, mitarbeiterId: null, leads: null };
    const jetzt = new Date("2026-11-01T11:00:00.000Z");
    const offen = await ladePlan("ws_1", abfrage, jetzt);
    const gefiltert = await ladePlan("ws_1", { ...abfrage, firmaId: "f_kottke" }, jetzt);

    expect(offen.heute).toBe("2026-11-01");
    expect(offen.eintraege.map((e) => [e.dealId, e.ton])).toEqual([
      ["d_andere", "gold"],
      ["d_multi", "jade"],
      ["d_grau", "grau"],
      ["d_strich", "gestrichelt"],
      ["d_violett", "violett"],
    ]);
    expect(gefiltert.eintraege.map((e) => e.dealId)).not.toContain("d_andere");
    expect(gefiltert.eintraege.map((e) => e.dealId)).toContain("d_multi");
    expect(gefiltert.kapazitaet).toEqual(offen.kapazitaet);
    expect(gefiltert.kapazitaet.map((k) => k.tag)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(gefiltert.buchungen).toEqual([]);
    expect(tag(gefiltert.kapazitaet, "2026-11-01").belegt.map((b) => b.deals[0]?.dealId)).toEqual(["d_andere"]);
    expect(tag(gefiltert.kapazitaet, "2026-11-04").frei.map((p) => p.id)).toEqual(["e1", "e3"]);
    expect(festeIds()).toEqual([
      ["d_andere", "d_multi"],
      ["d_andere", "d_multi"],
    ]);
  });
});
