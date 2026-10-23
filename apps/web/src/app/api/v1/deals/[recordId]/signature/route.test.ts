import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getDealSignature: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-signature", () => ({
  getDealSignature: mocks.getDealSignature,
}));

import { GET } from "./route";

const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: "ws_1",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "api_key",
  });
});

describe("GET /api/v1/deals/[recordId]/signature", () => {
  it("returns the signature view for a deal", async () => {
    mocks.getDealSignature.mockResolvedValue({
      dealRecordId: DEAL_ID,
      signatureEnabled: true,
      active: { status: "pending", coversCurrentTerms: false },
    });
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/signature`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.active.status).toBe("pending");
    expect(mocks.getDealSignature).toHaveBeenCalledWith("ws_1", DEAL_ID);
  });

  it("returns 404 when the deal is outside the workspace", async () => {
    mocks.getDealSignature.mockResolvedValue(null);
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/signature`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 without a session", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/signature`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    expect(res.status).toBe(401);
  });
});
