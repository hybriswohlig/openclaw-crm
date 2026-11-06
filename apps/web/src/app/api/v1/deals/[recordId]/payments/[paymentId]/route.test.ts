import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/financial", () => ({
  updatePayment: mocks.updatePayment,
  deletePayment: mocks.deletePayment,
}));

import { PUT } from "./route";

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
});

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
    );
  });
});
