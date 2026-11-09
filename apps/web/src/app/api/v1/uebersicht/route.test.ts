import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeUebersicht: vi.fn(),
  operatingCompanyInWorkspace: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/uebersicht", () => ({ ladeUebersicht: mocks.ladeUebersicht }));
vi.mock("@/services/customer-portal-config", () => ({
  operatingCompanyInWorkspace: mocks.operatingCompanyInWorkspace,
}));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const ANTWORT = { monate: ["2026-11"], firma: null, firmen: [], stand: "2026-11-08T11:00:00.000Z" };

const get = (query = "") => new NextRequest(`http://localhost/api/v1/uebersicht${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.operatingCompanyInWorkspace.mockResolvedValue(true);
  mocks.ladeUebersicht.mockResolvedValue(ANTWORT);
});

describe("GET /uebersicht", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(mocks.ladeUebersicht).not.toHaveBeenCalled();
    expect(mocks.operatingCompanyInWorkspace).not.toHaveBeenCalled();
  });

  it("API-Schlüssel 403, auch als Admin", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Nur in der angemeldeten Sitzung." },
    });
    expect(mocks.ladeUebersicht).not.toHaveBeenCalled();
  });

  it("Member 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, workspaceRole: "member" });
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(mocks.ladeUebersicht).not.toHaveBeenCalled();
    expect(mocks.operatingCompanyInWorkspace).not.toHaveBeenCalled();
  });

  it("fremde Firma 404", async () => {
    mocks.operatingCompanyInWorkspace.mockResolvedValue(false);
    const res = await GET(get("?firma=oc_fremd"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Firma nicht gefunden." },
    });
    expect(mocks.operatingCompanyInWorkspace).toHaveBeenCalledWith("ws_1", "oc_fremd");
    expect(mocks.ladeUebersicht).not.toHaveBeenCalled();
  });

  it("Admin mit Firma", async () => {
    const res = await GET(get("?firma=oc_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ANTWORT });
    expect(mocks.operatingCompanyInWorkspace).toHaveBeenCalledWith("ws_1", "oc_1");
    expect(mocks.ladeUebersicht).toHaveBeenCalledWith("ws_1", "oc_1");
  });

  it("Admin ohne Firma lädt alle", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(mocks.operatingCompanyInWorkspace).not.toHaveBeenCalled();
    expect(mocks.ladeUebersicht).toHaveBeenCalledWith("ws_1", null);
  });
});
