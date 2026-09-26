import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn(), ensureDealCalculation: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});
vi.mock("./kalkulation", () => ({ ensureDealCalculation: mocks.ensureDealCalculation }));

import { dealReferenz, kalkulationAnstossen } from "./ausloeser";

beforeEach(() => vi.clearAllMocks());

describe("kalkulationAnstossen", () => {
  it("registriert genau einen after-Callback, der die Kalkulation anstößt", async () => {
    mocks.ensureDealCalculation.mockResolvedValue({ status: "neu", kalkulation: null });
    kalkulationAnstossen("ws_1", "deal_1");
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.ensureDealCalculation).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Fehler der Kalkulation werden protokolliert, nicht geworfen", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureDealCalculation.mockRejectedValue(new Error("Rechner weg"));
    kalkulationAnstossen("ws_1", "deal_1");
    await expect(mocks.after.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("außerhalb einer Anfrage (after wirft): läuft trotzdem im Hintergrund, ohne zu werfen", async () => {
    mocks.after.mockImplementationOnce(() => { throw new Error("after was called outside a request scope"); });
    mocks.ensureDealCalculation.mockResolvedValue({ status: "neu", kalkulation: null });
    expect(() => kalkulationAnstossen("ws_1", "deal_1")).not.toThrow();
    await vi.waitFor(() => expect(mocks.ensureDealCalculation).toHaveBeenCalledWith("ws_1", "deal_1"));
  });

  it("ohne Lead-ID passiert nichts", () => {
    kalkulationAnstossen("ws_1", "");
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("mehrere Anstöße laufen nacheinander, nicht gleichzeitig (Review Sol: Cron-Spitzen)", async () => {
    let aktiv = 0, maxAktiv = 0;
    mocks.ensureDealCalculation.mockImplementation(async () => {
      aktiv += 1; maxAktiv = Math.max(maxAktiv, aktiv);
      await new Promise((r) => setTimeout(r, 5));
      aktiv -= 1;
      return { status: "neu", kalkulation: null };
    });
    kalkulationAnstossen("ws", "d1");
    kalkulationAnstossen("ws", "d2");
    kalkulationAnstossen("ws", "d3");
    await Promise.all(mocks.after.mock.calls.map((c) => c[0]()));
    expect(maxAktiv).toBe(1);
    expect(mocks.ensureDealCalculation).toHaveBeenCalledTimes(3);
  });
});

describe("dealReferenz", () => {
  it("liest die Lead-ID aus dem deal-Feld eines Auftrags (Review Sol)", () => {
    expect(dealReferenz({ deal: "d1" })).toBe("d1");
    expect(dealReferenz({ deal: { id: "d2", title: "Lead" } })).toBe("d2");
    expect(dealReferenz({ deal: [{ id: "d3" }] })).toBe("d3");
    expect(dealReferenz({})).toBeNull();
  });
});
