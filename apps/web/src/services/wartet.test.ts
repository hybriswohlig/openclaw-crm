import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}));

import { aktualisiereWartet, aktualisiereWartetFuer, waehleDealsZurNeuberechnung } from "./wartet";

/** Abfragekette, die jede Methode durchreicht und am Ende `zeilen` liefert. */
function kette(zeilen: unknown[]) {
  const k: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(k, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(zeilen).then(res, rej);
      return () => proxy;
    },
  });
  return proxy;
}

function sqlText(q: SQL) {
  return new PgDialect().sqlToQuery(q);
}

describe("aktualisiereWartet", () => {
  beforeEach(() => vi.clearAllMocks());

  // Review-Fokus 1: Konversation ohne Deal (deal_record_id ist null).
  it.each([null, undefined, ""])("kehrt bei Deal-Id %j ohne Datenbankzugriff zurück", async (id) => {
    await expect(aktualisiereWartet("ws-1", id)).resolves.toBeUndefined();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("liest und schreibt in einer Transaktion, nachdem die Sperre je Deal genommen ist", async () => {
    const reihenfolge: string[] = [];
    const werte = vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => reihenfolge.push("upsert")) }));
    const deal = { id: "deal-1", workspaceId: "ws-1", createdAt: new Date("2026-11-01T10:00:00Z"), titel: "Bezahlt", kategorie: "paid" };
    const tx = {
      execute: vi.fn(async (_abfrage: SQL) => reihenfolge.push("sperre")),
      select: vi
        .fn()
        .mockImplementationOnce(() => (reihenfolge.push("lesen"), kette([deal])))
        .mockImplementation(() => kette([])),
      insert: vi.fn(() => ({ values: werte })),
    };
    mocks.transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await aktualisiereWartet("ws-1", "deal-1");

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    // Kein Zugriff am globalen db vorbei.
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(reihenfolge).toEqual(["sperre", "lesen", "upsert"]);
    const { sql, params } = sqlText(tx.execute.mock.calls[0][0]);
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('wartet:' || v.id))");
    expect(params).toEqual(["deal-1"]);
    expect(werte).toHaveBeenCalledWith([
      expect.objectContaining({ recordId: "deal-1", waitingOn: "niemand", waitingReason: null }),
    ]);
  });

  it("sperrt im Block jeden Deal einmal, sortiert", async () => {
    const tx = {
      execute: vi.fn(async (_abfrage: SQL) => undefined),
      select: vi.fn(() => kette([])),
      insert: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await expect(aktualisiereWartetFuer("ws-1", ["deal-c", "deal-a", "deal-c", "deal-b"])).resolves.toBe(0);

    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(sqlText(tx.execute.mock.calls[0][0]).params).toEqual(["deal-a", "deal-b", "deal-c"]);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe("waehleDealsZurNeuberechnung", () => {
  const zeile = (id: string, kategorie: string | null, wartetAuf: string | null, workspaceId = "ws-1") => ({
    id,
    workspaceId,
    titel: kategorie === null ? null : `Stufe ${kategorie}`,
    kategorie,
    wartetAuf,
  });

  it("nimmt offene Deals immer, Endstufen nur mit gespeichertem Signal ungleich niemand", () => {
    const auswahl = waehleDealsZurNeuberechnung([
      zeile("offen-ohne-zeile", "quoted", null),
      zeile("offen-niemand", "booked", "niemand"),
      zeile("ohne-stufe", null, null),
      zeile("bezahlt-uns", "paid", "uns"),
      zeile("verloren-kunde", "lost", "kunde"),
      zeile("kein-lead-niemand", "kein_lead", "niemand"),
      zeile("bezahlt-ohne-zeile", "paid", null),
      zeile("anderer-ws", "lost", "uns", "ws-2"),
    ]);
    expect(auswahl.get("ws-1")).toEqual(["offen-ohne-zeile", "offen-niemand", "ohne-stufe", "bezahlt-uns", "verloren-kunde"]);
    expect(auswahl.get("ws-2")).toEqual(["anderer-ws"]);
  });

  it("führt doppelte Zeilen eines Deals zusammen", () => {
    const auswahl = waehleDealsZurNeuberechnung([zeile("d", "quoted", "uns"), zeile("d", "quoted", "uns")]);
    expect(auswahl.get("ws-1")).toEqual(["d"]);
  });
});
