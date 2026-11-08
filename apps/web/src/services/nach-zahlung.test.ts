import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  offenerRest: vi.fn(),
  emitEvent: vi.fn(),
  markiereDurchgefuehrt: vi.fn(),
  setzeStufeBetreten: vi.fn(),
  aktualisiereWartet: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert },
}));

vi.mock("./offener-rest", () => ({
  offenerRest: mocks.offenerRest,
}));

// records.ts läuft echt (bedingtes Schreiben und Folgen des Stufenwechsels); nur seine Nebenwirkungen sind ersetzt.
vi.mock("./activity-events", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("./durchgefuehrt", () => ({ markiereDurchgefuehrt: mocks.markiereDurchgefuehrt }));
vi.mock("./wartet", () => ({
  setzeStufeBetreten: mocks.setzeStufeBetreten,
  aktualisiereWartet: mocks.aktualisiereWartet,
}));

import { nachZahlung } from "./nach-zahlung";
import { recordValues, records } from "@/db/schema/records";

const dialect = new PgDialect();

/** Abfragekette, die jede Methode durchreicht und am Ende `zeilen` liefert. */
function kette(zeilen: unknown[], vorher?: () => void) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            vorher?.();
            return Promise.resolve(zeilen).then(res, rej);
          };
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

function dbLiefert(...antworten: unknown[][]) {
  const rest = [...antworten];
  mocks.select.mockImplementation(() => kette(rest.shift() ?? []));
}

/**
 * Stufe des Deals in der Datenbank. `UPDATE record_values` schreibt nur, wenn
 * die Bedingung `text_value = $n` (falls vorhanden) zum Stand passt, wie
 * Postgres bei einer bedingten Anweisung; ohne Bedingung überschreibt es.
 */
const stand = { stufe: "st-durchgefuehrt", recordTouch: 0, wertGesetzt: null as Record<string, unknown> | null };

function updateMock() {
  mocks.update.mockImplementation((tabelle: unknown) => ({
    set(werte: Record<string, unknown>) {
      return {
        where(bedingung: SQL) {
          let ergebnis: unknown[] = [];
          if (tabelle === recordValues) {
            const q = dialect.sqlToQuery(bedingung);
            const m = /"text_value" = \$(\d+)/.exec(q.sql);
            const passt = !m || q.params[Number(m[1]) - 1] === stand.stufe;
            if (passt) {
              stand.stufe = String(werte.textValue);
              stand.wertGesetzt = werte;
              ergebnis = [{ id: "rv-stufe" }];
            }
          } else if (tabelle === records) {
            stand.recordTouch += 1;
          }
          const fertig = Promise.resolve(ergebnis);
          return {
            returning: () => fertig,
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => fertig.then(res, rej),
          };
        },
      };
    },
  }));
}

const deal = "deal-1";
const ws = "ws-1";
/** Antworten in der Reihenfolge von nachZahlung: Rechnungsdatensätze, Zustand, Stufe, Bezahlt-Stufe. */
const GESTELLT = [{ status: "gestellt" }];
const ZUSTAND_LEER: unknown[] = [];
const DURCHGEFUEHRT = [
  { objectId: "obj-1", attributeId: "attr-1", statusId: "st-durchgefuehrt", kategorie: "done_unpaid", titel: "Durchgeführt" },
];

describe("nachZahlung", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stand.stufe = "st-durchgefuehrt";
    stand.recordTouch = 0;
    stand.wertGesetzt = null;
    updateMock();
    mocks.emitEvent.mockResolvedValue(undefined);
    mocks.markiereDurchgefuehrt.mockResolvedValue(undefined);
    mocks.setzeStufeBetreten.mockResolvedValue(undefined);
    mocks.aktualisiereWartet.mockResolvedValue(undefined);
    mocks.insert.mockImplementation(() => ({
      values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ id: deal }] }) }),
    }));
  });

  it("setzt von Durchgeführt auf Bezahlt, wenn eine Rechnung da ist und der Rest 0 ist, mit den Folgen des Stufenwechsels", async () => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 248000, bezahltCent: 248000, restCent: 0, quelle: "annahme" });
    dbLiefert(GESTELLT, ZUSTAND_LEER, DURCHGEFUEHRT, [{ id: "st-bezahlt" }]);

    await expect(nachZahlung(ws, deal, "usr-1")).resolves.toEqual({ stufeGesetzt: true, bezahltAm: "gesetzt" });
    expect(mocks.insert).toHaveBeenCalledTimes(1);

    expect(mocks.offenerRest).toHaveBeenCalledWith(ws, deal);
    expect(stand.stufe).toBe("st-bezahlt");
    expect(stand.wertGesetzt).toMatchObject({ textValue: "st-bezahlt", createdBy: "usr-1" });
    expect(stand.recordTouch).toBe(1);
    expect(mocks.emitEvent).toHaveBeenCalledTimes(1);
    expect(mocks.emitEvent).toHaveBeenCalledWith({
      workspaceId: ws,
      recordId: deal,
      objectSlug: "deals",
      eventType: "deal.stage_changed",
      payload: { attributeSlug: "stage", fromStatusId: "st-durchgefuehrt", toStatusId: "st-bezahlt" },
      actorId: "usr-1",
    });
    expect(mocks.markiereDurchgefuehrt).toHaveBeenCalledWith({
      workspaceId: ws,
      objectId: "obj-1",
      objectSlug: "deals",
      recordId: deal,
      toStatusId: "st-bezahlt",
      updatedBy: "usr-1",
    });
    expect(mocks.setzeStufeBetreten).toHaveBeenCalledWith(deal, expect.any(Date));
    expect(mocks.aktualisiereWartet).toHaveBeenCalledWith(ws, deal);
  });

  it("Stufe wechselt zwischen Lesen und Schreiben (etwa auf Verloren): kein Überschreiben, stufeGesetzt false, keine Folgen", async () => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 248000, bezahltCent: 248000, restCent: 0, quelle: "annahme" });
    const rest: unknown[][] = [GESTELLT, ZUSTAND_LEER, DURCHGEFUEHRT];
    mocks.select.mockImplementation(() => {
      const zeilen = rest.shift();
      if (zeilen) return kette(zeilen);
      // Die Suche nach der Bezahlt-Stufe: in diesem Moment setzt ein anderer Nutzer Verloren.
      return kette([{ id: "st-bezahlt" }], () => {
        stand.stufe = "st-verloren";
      });
    });

    await expect(nachZahlung(ws, deal, "usr-1")).resolves.toEqual({ stufeGesetzt: false, bezahltAm: "gesetzt" });

    expect(stand.stufe).toBe("st-verloren");
    expect(stand.recordTouch).toBe(0);
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.markiereDurchgefuehrt).not.toHaveBeenCalled();
    expect(mocks.setzeStufeBetreten).not.toHaveBeenCalled();
    expect(mocks.aktualisiereWartet).not.toHaveBeenCalled();
  });

  it.each([
    ["Rest größer 0", { restCent: 198000 }, [GESTELLT, ZUSTAND_LEER, DURCHGEFUEHRT]],
    ["Rest null", { restCent: null }, [GESTELLT, ZUSTAND_LEER, DURCHGEFUEHRT]],
    ["keine Rechnung (weder Datensatz noch PDF)", { restCent: 0 }, [[], [], ZUSTAND_LEER, DURCHGEFUEHRT]],
    ["nur stornierte Rechnung", { restCent: 0 }, [[{ status: "storniert" }], ZUSTAND_LEER, DURCHGEFUEHRT]],
  ] as const)("%s: weder Stufe noch bezahlt_am", async (_name, rest, antworten) => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: null, bezahltCent: 0, quelle: "keins", ...rest });
    dbLiefert(...(antworten as unknown as unknown[][]));

    await expect(nachZahlung(ws, deal, null)).resolves.toEqual({ stufeGesetzt: false, bezahltAm: null });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.emitEvent).not.toHaveBeenCalled();
  });

  it("Altbestand: ein Rechnungs-PDF ohne Datensatz zählt als gestellt", async () => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 1000, bezahltCent: 1000, restCent: 0, quelle: "annahme" });
    dbLiefert([], [{ id: "pdf-1" }], ZUSTAND_LEER, DURCHGEFUEHRT, [{ id: "st-bezahlt" }]);
    await expect(nachZahlung(ws, deal, null)).resolves.toEqual({ stufeGesetzt: true, bezahltAm: "gesetzt" });
  });

  it("andere Stufe: bezahlt_am ja, Stufe nein; ohne Bezahlt-Stufe ebenso", async () => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 1000, bezahltCent: 1000, restCent: 0, quelle: "rechnung" });
    dbLiefert(GESTELLT, ZUSTAND_LEER, [{ objectId: "obj-1", attributeId: "attr-1", statusId: "st-geplant", kategorie: "booked", titel: "Geplant" }]);
    await expect(nachZahlung(ws, deal, null)).resolves.toEqual({ stufeGesetzt: false, bezahltAm: "gesetzt" });
    dbLiefert(GESTELLT, ZUSTAND_LEER, DURCHGEFUEHRT, []);
    await expect(nachZahlung(ws, deal, null)).resolves.toEqual({ stufeGesetzt: false, bezahltAm: "gesetzt" });
    expect(mocks.emitEvent).not.toHaveBeenCalled();
  });

  it("Rest nach Storno wieder offen: bezahlt_am wird geleert, die Stufe geht nie zurück", async () => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 1000, bezahltCent: 500, restCent: 500, quelle: "rechnung" });
    dbLiefert(GESTELLT, [{ bezahltAm: new Date("2026-11-01T10:00:00Z") }], [
      { objectId: "obj-1", attributeId: "attr-1", statusId: "st-bezahlt", kategorie: "paid", titel: "Bezahlt" },
    ]);
    mocks.update.mockImplementation(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: deal }] }) }) }));
    await expect(nachZahlung(ws, deal, null)).resolves.toEqual({ stufeGesetzt: false, bezahltAm: "geleert" });
    expect(mocks.emitEvent).not.toHaveBeenCalled();
  });
});
