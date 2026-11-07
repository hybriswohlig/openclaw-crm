import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** F2: Paketoptionen nur für Deals des eigenen Workspace (sonst 404, nichts gelesen oder geschrieben). */
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  replaceDealPackageOptions: vi.fn(),
  dbLesen: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => {
            mocks.dbLesen();
            return [];
          },
          limit: async () => {
            mocks.dbLesen();
            return [];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/customer-portal-data", () => ({ replaceDealPackageOptions: mocks.replaceDealPackageOptions }));

import { DELETE, GET, PUT } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const URL_ = "http://localhost/api/v1/deals/deal_fremd/package-options";
const p = () => ({ params: Promise.resolve({ recordId: "deal_fremd" }) });
const body = { options: [{ displayName: "Basis", priceCents: 90000, catalogueSlug: "basis" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(false);
  mocks.replaceDealPackageOptions.mockResolvedValue({ count: 1 });
});

describe("package-options: Deal aus fremdem Workspace", () => {
  it("PUT → 404, schreibt nichts", async () => {
    const res = await PUT(new NextRequest(URL_, { method: "PUT", body: JSON.stringify(body) }), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_fremd");
    expect(mocks.replaceDealPackageOptions).not.toHaveBeenCalled();
  });
  it("DELETE → 404, löscht nichts", async () => {
    const res = await DELETE(new NextRequest(URL_, { method: "DELETE" }), p());
    expect(res.status).toBe(404);
    expect(mocks.replaceDealPackageOptions).not.toHaveBeenCalled();
  });
  it("GET → 404, liest nichts", async () => {
    const res = await GET(new NextRequest(URL_), p());
    expect(res.status).toBe(404);
    expect(mocks.dbLesen).not.toHaveBeenCalled();
  });
  it("eigener Deal: PUT schreibt wie bisher", async () => {
    mocks.dealImWorkspace.mockResolvedValue(true);
    const res = await PUT(new NextRequest(URL_, { method: "PUT", body: JSON.stringify(body) }), p());
    expect(res.status).toBe(200);
    expect(mocks.replaceDealPackageOptions).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws_1", dealRecordId: "deal_fremd" }));
  });
});
