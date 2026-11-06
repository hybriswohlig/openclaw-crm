import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ladeAktiveAnnahme: vi.fn(),
  getQuotation: vi.fn(),
  listPayments: vi.fn(),
}));

vi.mock("./kva-annahme", () => ({
  ladeAktiveAnnahme: mocks.ladeAktiveAnnahme,
}));

vi.mock("./quotations", () => ({
  getQuotation: mocks.getQuotation,
}));

vi.mock("./financial", () => ({
  listPayments: mocks.listPayments,
}));

import { offenerRest } from "./offener-rest";

describe("offenerRest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lädt Annahme, Angebot und Zahlungen und rechnet den Rest", async () => {
    mocks.ladeAktiveAnnahme.mockResolvedValue({ confirmedTotalCents: 248000 });
    mocks.getQuotation.mockResolvedValue({ fixedPrice: "100.00", isVariable: false });
    mocks.listPayments.mockResolvedValue([
      { workspaceId: "ws-1", amount: "500.00", taxTreatment: "betriebseinnahme" },
      { workspaceId: "ws-fremd", amount: "900.00", taxTreatment: "betriebseinnahme" },
      { workspaceId: "ws-1", amount: "200.00", taxTreatment: "nicht_steuerbar" },
    ]);

    await expect(offenerRest("ws-1", "deal-1")).resolves.toEqual({
      gesamtCent: 248000,
      bezahltCent: 50000,
      restCent: 198000,
      quelle: "annahme",
    });

    expect(mocks.ladeAktiveAnnahme).toHaveBeenCalledWith("deal-1");
    expect(mocks.getQuotation).toHaveBeenCalledWith("deal-1");
    expect(mocks.listPayments).toHaveBeenCalledWith("deal-1");
  });

  it("ohne Annahme nimmt Festpreis und Stunden-Kennzeichen aus dem Angebot", async () => {
    mocks.ladeAktiveAnnahme.mockResolvedValue(null);
    mocks.getQuotation.mockResolvedValue({ fixedPrice: "2480.00", isVariable: true });
    mocks.listPayments.mockResolvedValue([]);

    await expect(offenerRest("ws-1", "deal-1")).resolves.toMatchObject({ quelle: "stunden", restCent: null });
  });
});
