import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  offenerRest: vi.fn(),
  updateRecord: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: mocks.select },
}));

vi.mock("./offener-rest", () => ({
  offenerRest: mocks.offenerRest,
}));

vi.mock("./records", () => ({
  updateRecord: mocks.updateRecord,
}));

import { nachZahlung } from "./nach-zahlung";

/** Abfragekette, die jede Methode durchreicht und am Ende `zeilen` liefert. */
function kette(zeilen: unknown[]) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(zeilen).then(res, rej);
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

const deal = "deal-1";
const ws = "ws-1";

describe("nachZahlung", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateRecord.mockResolvedValue({ id: deal });
  });

  it("setzt von Durchgeführt auf Bezahlt, wenn eine Rechnung da ist und der Rest 0 ist", async () => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 248000, bezahltCent: 248000, restCent: 0, quelle: "annahme" });
    dbLiefert(
      [{ id: "rechnung-1" }],
      [{ objectId: "obj-1", attributeId: "attr-1", kategorie: "done_unpaid", titel: "Durchgeführt" }],
      [{ id: "st-bezahlt" }],
    );

    await expect(nachZahlung(ws, deal, "usr-1")).resolves.toEqual({ stufeGesetzt: true });

    expect(mocks.offenerRest).toHaveBeenCalledWith(ws, deal);
    expect(mocks.updateRecord).toHaveBeenCalledWith("obj-1", deal, { stage: "st-bezahlt" }, "usr-1");
  });

  it.each([
    ["Rest größer 0", { restCent: 198000 }, []],
    ["Rest null", { restCent: null }, []],
    ["keine Rechnung", { restCent: 0 }, [[]]],
    [
      "andere Stufe",
      { restCent: 0 },
      [[{ id: "rechnung-1" }], [{ objectId: "obj-1", attributeId: "attr-1", kategorie: "booked", titel: "Geplant" }]],
    ],
  ] as const)("%s ändert die Stufe nicht", async (_name, rest, antworten) => {
    mocks.offenerRest.mockResolvedValue({ gesamtCent: null, bezahltCent: 0, quelle: "keins", ...rest });
    dbLiefert(...(antworten as unknown as unknown[][]));

    await expect(nachZahlung(ws, deal, null)).resolves.toEqual({ stufeGesetzt: false });
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });
});
