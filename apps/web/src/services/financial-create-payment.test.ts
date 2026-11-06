import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  txValues: vi.fn(),
  aktualisiereWartet: vi.fn(),
}));

// db.select ist nur die Firmen-Suche (resolveDealOperatingCompany); sie findet nichts.
vi.mock("@/db", () => {
  const leer = () => ({
    from: () => ({
      innerJoin: () => ({ where: () => ({ limit: async () => [] }) }),
      where: () => ({ limit: async () => [] }),
    }),
  });
  return {
    db: {
      select: (...a: unknown[]) => {
        mocks.dbSelect(...a);
        return leer();
      },
      transaction: () => {
        throw new Error("Test übergibt tx");
      },
    },
  };
});
vi.mock("./wartet", () => ({ aktualisiereWartet: mocks.aktualisiereWartet }));

import { createPayment } from "./financial";

const tx = {
  insert: () => ({
    values: (v: unknown) => {
      mocks.txValues(v);
      return { returning: async () => [{ id: "pay_1" }] };
    },
  }),
} as never;
const EINGABE = { date: "2026-11-06", amount: "100.00", taxTreatment: "betriebseinnahme" as const };

beforeEach(() => vi.clearAllMocks());

describe("createPayment: Firma", () => {
  it("übergebene Firma (auch null) → keine eigene Suche über db", async () => {
    await createPayment("ws_1", "deal_1", { ...EINGABE, operatingCompanyId: null }, tx);
    await createPayment("ws_1", "deal_1", { ...EINGABE, operatingCompanyId: "oc_1", taxTreatment: "nicht_steuerbar" }, tx);
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.txValues).toHaveBeenNthCalledWith(1, expect.objectContaining({ operatingCompanyId: null }));
    expect(mocks.txValues).toHaveBeenNthCalledWith(2, expect.objectContaining({ operatingCompanyId: "oc_1" }));
  });

  it("ohne Firma in der Eingabe → aus dem Auftrag abgeleitet", async () => {
    await createPayment("ws_1", "deal_1", EINGABE, tx);
    expect(mocks.dbSelect).toHaveBeenCalled();
    expect(mocks.txValues).toHaveBeenCalledWith(expect.objectContaining({ operatingCompanyId: null }));
  });
});
