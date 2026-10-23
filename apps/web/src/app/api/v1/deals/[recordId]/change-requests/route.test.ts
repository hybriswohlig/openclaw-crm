import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  listDealChangeRequests: vi.fn(),
  resolveDealChangeRequest: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-change-requests", () => ({
  listDealChangeRequests: mocks.listDealChangeRequests,
  resolveDealChangeRequest: mocks.resolveDealChangeRequest,
}));

import { GET } from "./route";
import { PATCH } from "./[requestId]/route";

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

describe("deal change requests", () => {
  it("lists requests and defaults the filter to all", async () => {
    mocks.listDealChangeRequests.mockResolvedValue([
      { id: "evt_1", kind: "question", status: "open", message: "Anderes Datum" },
    ]);
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/change-requests`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.requests).toHaveLength(1);
    expect(mocks.listDealChangeRequests).toHaveBeenCalledWith("ws_1", DEAL_ID, "all");
  });

  it("rejects an unknown status", async () => {
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/change-requests?status=nope`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    expect(res.status).toBe(400);
  });

  it("marks a request handled", async () => {
    mocks.resolveDealChangeRequest.mockResolvedValue({
      alreadyHandled: false,
      request: { id: "evt_1", status: "handled" },
    });
    const res = await PATCH(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/change-requests/evt_1`, {
        method: "PATCH",
      }),
      { params: Promise.resolve({ recordId: DEAL_ID, requestId: "evt_1" }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.alreadyHandled).toBe(false);
    expect(mocks.resolveDealChangeRequest).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: DEAL_ID,
      requestId: "evt_1",
      userId: "usr_1",
    });
  });
});
