import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  operatingCompanyInWorkspace: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/customer-portal-config", () => ({
  operatingCompanyInWorkspace: mocks.operatingCompanyInWorkspace,
}));

import { GET, PUT } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const p = { params: Promise.resolve({ ocId: "oc_1" }) };
const anfrage = (method: "GET" | "PUT", body?: unknown) =>
  new NextRequest("http://localhost/api/v1/einsatz/firmen/oc_1", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.operatingCompanyInWorkspace.mockResolvedValue(true);
});

describe("GET/PUT /api/v1/einsatz/firmen/[ocId]", () => {
  it.each(["read", "full"] as const)("API-Schlüssel %s → 403 NUR_MENSCH auf GET und PUT", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: zugriff });
    for (const methode of ["GET", "PUT"] as const) {
      const res = methode === "GET" ? await GET(anfrage("GET"), p) : await PUT(anfrage("PUT", { buchungImPreis: true }), p);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("NUR_MENSCH");
    }
    expect(mocks.operatingCompanyInWorkspace).not.toHaveBeenCalled();
  });

  it("fremde Firma → 404", async () => {
    mocks.operatingCompanyInWorkspace.mockResolvedValue(false);
    expect((await GET(anfrage("GET"), p)).status).toBe(404);
    expect((await PUT(anfrage("PUT", { buchungImPreis: true }), p)).status).toBe(404);
    expect(mocks.operatingCompanyInWorkspace).toHaveBeenCalledWith("ws_1", "oc_1");
  });

  it("PUT ohne Boolean → 400", async () => {
    expect((await PUT(anfrage("PUT", { buchungImPreis: "ja" }), p)).status).toBe(400);
    expect((await PUT(anfrage("PUT", "kein json"), p)).status).toBe(400);
    expect(mocks.operatingCompanyInWorkspace).not.toHaveBeenCalled();
  });

  it("PUT als Member → 403, GET bleibt erlaubt", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, workspaceRole: "member" });
    expect((await PUT(anfrage("PUT", { buchungImPreis: true }), p)).status).toBe(403);
    expect(mocks.operatingCompanyInWorkspace).not.toHaveBeenCalled();
  });
});
