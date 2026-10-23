import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createDateOffer: vi.fn(),
  updateDateOffer: vi.fn(),
  deleteDateOffer: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/customer-portal-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/customer-portal-data")>();
  return {
    ...actual,
    createDateOffer: mocks.createDateOffer,
    updateDateOffer: mocks.updateDateOffer,
    deleteDateOffer: mocks.deleteDateOffer,
  };
});

vi.mock("@/db", () => ({ db: {} }));

import { POST } from "./route";
import { PATCH, DELETE } from "./[offerId]/route";

const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: "ws_1",
    workspaceRole: "member",
    permissions: {},
    authMethod: "api_key",
  });
});

function json(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("date offer writes", () => {
  it("creates one offer", async () => {
    mocks.createDateOffer.mockResolvedValue({ id: "off_1" });
    const res = await POST(
      json("POST", `https://crm.test/api/v1/deals/${DEAL_ID}/date-offers`, {
        date: "2026-11-04",
        slots: [{ label: "Vormittag", startTime: "08:00" }],
        isRecommended: true,
      }),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.id).toBe("off_1");
    expect(mocks.createDateOffer).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: DEAL_ID,
      createdBy: "usr_1",
      offer: {
        date: "2026-11-04",
        slots: [{ label: "Vormittag", startTime: "08:00", endTime: null }],
        note: null,
        isRecommended: true,
      },
    });
  });

  it("returns 409 while an acceptance is active", async () => {
    mocks.createDateOffer.mockRejectedValue(new AngebotAngenommenError());
    const res = await POST(
      json("POST", `https://crm.test/api/v1/deals/${DEAL_ID}/date-offers`, {
        date: "2026-11-04",
        slots: [{ label: "Vormittag" }],
      }),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    expect(res.status).toBe(409);
  });

  it("updates and deletes one offer", async () => {
    mocks.updateDateOffer.mockResolvedValue({ id: "off_1", date: "2026-11-05" });
    const updated = await PATCH(
      json("PATCH", `https://crm.test/api/v1/deals/${DEAL_ID}/date-offers/off_1`, {
        date: "2026-11-05",
      }),
      { params: Promise.resolve({ recordId: DEAL_ID, offerId: "off_1" }) }
    );
    expect(updated.status).toBe(200);
    expect(mocks.updateDateOffer).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: "off_1", patch: { date: "2026-11-05" } })
    );

    mocks.deleteDateOffer.mockResolvedValue({ id: "off_1" });
    const deleted = await DELETE(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/date-offers/off_1`, { method: "DELETE" }),
      { params: Promise.resolve({ recordId: DEAL_ID, offerId: "off_1" }) }
    );
    expect(deleted.status).toBe(200);
  });
});
