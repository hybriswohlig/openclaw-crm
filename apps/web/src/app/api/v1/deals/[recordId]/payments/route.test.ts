import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZAHLUNGSART_FEHLER } from "@/lib/zahlungsart";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createPayment: vi.fn(),
  resolveDealOperatingCompany: vi.fn(),
  listPayments: vi.fn(),
  maybeNotifyDepositReceived: vi.fn(),
  nachZahlung: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/financial", () => ({
  listPayments: mocks.listPayments,
  createPayment: mocks.createPayment,
  resolveDealOperatingCompany: mocks.resolveDealOperatingCompany,
}));

vi.mock("@/services/customer-portal-notifications", () => ({
  maybeNotifyDepositReceived: mocks.maybeNotifyDepositReceived,
}));

vi.mock("@/services/nach-zahlung", () => ({
  nachZahlung: mocks.nachZahlung,
}));

import { POST } from "./route";

const WORKSPACE_ID = "ws-1";
const DEAL_ID = "deal-1";
const AUTH = {
  userId: "usr-1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: DEAL_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH);
  mocks.resolveDealOperatingCompany.mockResolvedValue("oc-1");
  mocks.createPayment.mockResolvedValue({ id: "pay-1", paymentMethod: "bank_transfer" });
  mocks.maybeNotifyDepositReceived.mockResolvedValue(undefined);
  mocks.nachZahlung.mockResolvedValue({ stufeGesetzt: false });
});

describe("POST /api/v1/deals/[recordId]/payments", () => {
  it("speichert „ueberweisung“ als bank_transfer und setzt danach die Stufe", async () => {
    const res = await post({ date: "2026-11-06", amount: "500.00", paymentMethod: "ueberweisung" });

    expect(res.status).toBe(201);
    expect(mocks.createPayment).toHaveBeenCalledWith(
      WORKSPACE_ID,
      DEAL_ID,
      expect.objectContaining({ paymentMethod: "bank_transfer", amount: "500.00", date: "2026-11-06" }),
    );
    expect(mocks.nachZahlung).toHaveBeenCalledWith(WORKSPACE_ID, DEAL_ID, "usr-1");
  });

  it("lehnt „Scheck“ ab und speichert nichts", async () => {
    const res = await post({ date: "2026-11-06", amount: "500.00", paymentMethod: "Scheck" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe(ZAHLUNGSART_FEHLER);
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.nachZahlung).not.toHaveBeenCalled();
  });

  it("liefert die Zahlung auch, wenn das Setzen der Stufe scheitert", async () => {
    mocks.nachZahlung.mockRejectedValue(new Error("stufe"));
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ date: "2026-11-06", amount: "10", paymentMethod: "bar" });

    expect(res.status).toBe(201);
    expect(mocks.createPayment).toHaveBeenCalledWith(
      WORKSPACE_ID,
      DEAL_ID,
      expect.objectContaining({ paymentMethod: "cash" }),
    );
    fehler.mockRestore();
  });
});
