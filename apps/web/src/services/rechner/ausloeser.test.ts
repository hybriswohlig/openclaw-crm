import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn(), ensureDealCalculation: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});
vi.mock("./kalkulation", () => ({ ensureDealCalculation: mocks.ensureDealCalculation }));

import { kalkulationAnstossen } from "./ausloeser";

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
});
