import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createCompanyBooking: vi.fn(),
  listCompanyBookings: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/financial", () => ({
  createCompanyBooking: mocks.createCompanyBooking,
  listCompanyBookings: mocks.listCompanyBookings,
}));

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

vi.mock("@/db", () => ({
  db: { select: mocks.select },
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr-1",
    workspaceId: "ws-1",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "cookie",
  });
  mocks.select.mockImplementation(() => kette([{ id: "oc-1" }]));
  mocks.createCompanyBooking.mockResolvedValue({ id: "buch-1", paymentMethod: "bank_transfer" });
});

describe("POST /api/v1/financial/bookings", () => {
  it("speichert „ueberweisung“ als bank_transfer", async () => {
    const res = await POST(
      new NextRequest("https://crm.test/api/v1/financial/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "income",
          operatingCompanyId: "oc-1",
          date: "2026-11-06",
          amount: "10",
          paymentMethod: "ueberweisung",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(mocks.createCompanyBooking).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ paymentMethod: "bank_transfer" }),
    );
  });
});
