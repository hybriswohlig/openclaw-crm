import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getCockpit: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/cockpit", () => ({ getCockpit: mocks.getCockpit }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const };
const req = (query = "") => new NextRequest(`http://localhost/api/v1/inbox/cockpit${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.getCockpit.mockResolvedValue({ generatedAt: "2026-10-22T10:00:00.000Z", companies: [], bridge: [], unlinkedChats: 0, items: [] });
});

describe("GET /api/v1/inbox/cockpit", () => {
  it("ohne Anmeldung 401 und kein Zugriff auf den Service", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.getCockpit).not.toHaveBeenCalled();
  });

  it("liefert das Aggregat im data-Umschlag", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ unlinkedChats: 0, items: [] });
    expect(mocks.getCockpit).toHaveBeenCalledWith("ws_1", { company: undefined, limit: undefined });
  });

  it("reicht Firma und Limit durch und begrenzt das Limit", async () => {
    await GET(req("?company=oc-k&limit=9999"));
    expect(mocks.getCockpit).toHaveBeenCalledWith("ws_1", { company: "oc-k", limit: 500 });
    await GET(req("?limit=0"));
    expect(mocks.getCockpit).toHaveBeenLastCalledWith("ws_1", { company: undefined, limit: 1 });
    await GET(req("?limit=abc"));
    expect(mocks.getCockpit).toHaveBeenLastCalledWith("ws_1", { company: undefined, limit: undefined });
  });
});
