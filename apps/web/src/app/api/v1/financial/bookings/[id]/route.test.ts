import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  updateCompanyBooking: vi.fn(),
  deleteCompanyBooking: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/financial", () => ({
  updateCompanyBooking: mocks.updateCompanyBooking,
  deleteCompanyBooking: mocks.deleteCompanyBooking,
}));

vi.mock("@/db", () => ({
  db: { select: vi.fn() },
}));

import { PUT } from "./route";

const WORKSPACE_ID = "ws-1";
const BOOKING_ID = "buch-1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr-1",
    workspaceId: WORKSPACE_ID,
    workspaceRole: "admin",
    permissions: {},
    authMethod: "cookie",
  });
  mocks.updateCompanyBooking.mockResolvedValue({ id: BOOKING_ID, paymentMethod: "cash" });
});

describe("PUT /api/v1/financial/bookings/[id]", () => {
  it("speichert „bar“ als cash", async () => {
    const res = await PUT(
      new NextRequest(`https://crm.test/api/v1/financial/bookings/${BOOKING_ID}?type=income`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentMethod: "bar" }),
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.updateCompanyBooking).toHaveBeenCalledWith(
      BOOKING_ID,
      "income",
      WORKSPACE_ID,
      expect.objectContaining({ paymentMethod: "cash" }),
    );
  });
});
