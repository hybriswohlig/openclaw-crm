import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
  dealImWorkspace: vi.fn(),
}));

vi.mock("@/lib/kalkulation-versionen-antwort", async (orig) => ({
  ...(await orig<typeof import("@/lib/kalkulation-versionen-antwort")>()),
  dealImWorkspace: mocks.dealImWorkspace,
}));
vi.mock("@/services/customer-portal-notifications", () => ({ maybeNotifyDepositReceived: async () => {} }));
vi.mock("@/services/nach-zahlung", () => ({ nachZahlung: async () => ({ stufeGesetzt: false }) }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/financial", () => ({
  updatePayment: mocks.updatePayment,
  deletePayment: mocks.deletePayment,
}));

import { DELETE, PUT } from "./route";
import { GeldFehler } from "@/lib/geld";

const WORKSPACE_ID = "ws-1";
const DEAL_ID = "deal-1";
const PAYMENT_ID = "pay-1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr-1",
    workspaceId: WORKSPACE_ID,
    workspaceRole: "admin",
    permissions: {},
    authMethod: "cookie",
  });
  mocks.updatePayment.mockResolvedValue({ id: PAYMENT_ID, paymentMethod: "cash" });
  mocks.dealImWorkspace.mockResolvedValue(true);
});

const req = (method: "PUT" | "DELETE", body?: unknown) =>
  new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/payments/${PAYMENT_ID}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ recordId: DEAL_ID, paymentId: PAYMENT_ID }) };

describe("PUT /api/v1/deals/[recordId]/payments/[paymentId]", () => {
  it("speichert „Bar“ als cash", async () => {
    const res = await PUT(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/payments/${PAYMENT_ID}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentMethod: "Bar" }),
      }),
      { params: Promise.resolve({ recordId: DEAL_ID, paymentId: PAYMENT_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.updatePayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      WORKSPACE_ID,
      expect.objectContaining({ paymentMethod: "cash" }),
      { dealRecordId: DEAL_ID, userId: "usr-1" },
    );
  });

  it("Betrag ändern → 409 NUR_KORREKTUR aus dem Dienst", async () => {
    mocks.updatePayment.mockRejectedValue(new GeldFehler("NUR_KORREKTUR"));
    const res = await PUT(req("PUT", { amount: "999" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NUR_KORREKTUR");
  });

  it("Zahlung eines anderen Deals → 404", async () => {
    mocks.updatePayment.mockResolvedValue(null);
    expect((await PUT(req("PUT", { notes: "x" }), params)).status).toBe(404);
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await PUT(req("PUT", { notes: "x" }), params)).status).toBe(404);
  });

  it("DELETE mit Belegnummer → 409 NUR_STORNO; ohne → gelöscht", async () => {
    mocks.deletePayment.mockRejectedValueOnce(new GeldFehler("NUR_STORNO"));
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NUR_STORNO");
    mocks.deletePayment.mockResolvedValueOnce({ id: PAYMENT_ID, dealRecordId: DEAL_ID });
    expect((await DELETE(req("DELETE"), params)).status).toBe(200);
    expect(mocks.deletePayment).toHaveBeenLastCalledWith(PAYMENT_ID, WORKSPACE_ID, DEAL_ID);
  });

  it("Agent und Nur-Lesen → 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ userId: "u", workspaceId: WORKSPACE_ID, workspaceRole: "admin", authMethod: "api_key" });
    expect((await PUT(req("PUT", { notes: "x" }), params)).status).toBe(403);
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  });
});
