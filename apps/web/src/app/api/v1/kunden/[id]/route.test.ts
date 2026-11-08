import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeKundenAkte: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, {
    get(_t, p) {
      if (p === "then" || typeof p === "symbol") return undefined;
      throw new Error(`@/db im Test (${String(p)})`);
    },
  }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/kunden", () => ({ ladeKundenAkte: mocks.ladeKundenAkte }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const, permissions: {} };
const params = Promise.resolve({ id: "p_1" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeKundenAkte.mockResolvedValue({ personId: "p_1", name: "Erika" });
});

describe("GET /api/v1/kunden/[id]", () => {
  it("API-Schlüssel bekommt 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key" });
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden/p_1"), { params });
    expect(res.status).toBe(403);
    expect(mocks.ladeKundenAkte).not.toHaveBeenCalled();
  });

  it("404 wenn die Akte fehlt", async () => {
    mocks.ladeKundenAkte.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden/p_1"), { params });
    expect(res.status).toBe(404);
    expect(mocks.ladeKundenAkte).toHaveBeenCalledWith("ws_1", "p_1");
  });

  it("Sitzung liefert die Akte des Workspace", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden/p_1"), { params });
    expect(res.status).toBe(200);
    expect(mocks.ladeKundenAkte).toHaveBeenCalledWith("ws_1", "p_1");
    expect((await res.json()).data.name).toBe("Erika");
  });
});
