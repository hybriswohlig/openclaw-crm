import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const mocks = vi.hoisted(() => ({
  getRecord: vi.fn(),
  getDealInventory: vi.fn(),
  ladeFirmenEinstellungen: vi.fn(),
}));

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    const passthrough = () => q;
    q.from = passthrough;
    q.leftJoin = passthrough;
    q.innerJoin = passthrough;
    q.where = passthrough;
    q.limit = async () => reads.queue.shift() ?? [];
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(reads.queue.shift() ?? []).then(resolve, reject);
    return q;
  };
  return { db: { select: () => chain() } };
});
vi.mock("@/services/records", () => ({ getRecord: mocks.getRecord }));
vi.mock("@/services/deal-inventory", () => ({ getDealInventory: mocks.getDealInventory }));
vi.mock("@/services/company-settings", () => ({ ladeFirmenEinstellungen: mocks.ladeFirmenEinstellungen }));

import { ladeLeadDaten } from "./lead-daten";

/** deals-Objekt, kein Auftrag, Betriebsfirma, keine Konversation, kein KV. */
function warteschlange() {
  reads.queue = [
    [{ id: "obj_deals" }],
    [],
    [{ id: "obj_oc" }],
    [],
    [],
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealInventory.mockResolvedValue([]);
  mocks.getRecord.mockImplementation(async (objectId: string) => {
    if (objectId === "obj_deals") return { values: { operating_company: "oc_1" } };
    if (objectId === "obj_oc") return { values: { name: "Ceylan Operations" } };
    return null;
  });
});

describe("ladeLeadDaten Marke", () => {
  it("nimmt die gespeicherte Rechner-Marke, sonst den Firmennamen", async () => {
    warteschlange();
    mocks.ladeFirmenEinstellungen.mockResolvedValue({ zeitposten: [], rechnerMarke: "kottke" });
    await expect(ladeLeadDaten("ws_1", "deal_1")).resolves.toMatchObject({ marke: "kottke" });
    expect(mocks.ladeFirmenEinstellungen).toHaveBeenCalledWith("ws_1", "oc_1");

    warteschlange();
    mocks.ladeFirmenEinstellungen.mockResolvedValue({ zeitposten: [], rechnerMarke: null });
    await expect(ladeLeadDaten("ws_1", "deal_1")).resolves.toMatchObject({ marke: "ceylan" });
  });
});
