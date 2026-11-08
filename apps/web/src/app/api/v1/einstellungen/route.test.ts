import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeEinstellungen: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/einstellungen", () => ({ ladeEinstellungen: mocks.ladeEinstellungen }));

import { GET } from "./route";

const ADMIN = { userId: "u1", workspaceId: "ws1", workspaceRole: "admin" as const, permissions: {}, authMethod: "cookie" as const };
const aufruf = () => GET(new NextRequest("https://crm.test/api/v1/einstellungen"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ladeEinstellungen.mockImplementation(async (ctx: { workspaceRole: string }) => ({
    ich: { darstellung: "system", kalender: { pfad: null, erstelltAm: null } },
    admin: ctx.workspaceRole === "admin",
    firmen: ctx.workspaceRole === "admin" ? [] : null,
    apiSchluessel: ctx.workspaceRole === "admin" ? [] : null,
  }));
});

describe("GET /api/v1/einstellungen", () => {
  it("401 ohne Anmeldung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await aufruf()).status).toBe(401);
    expect(mocks.ladeEinstellungen).not.toHaveBeenCalled();
  });

  it.each(["read", "full"])("403 für API-Schlüssel (%s)", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, authMethod: "api_key", apiKeyAccess: zugriff });
    expect((await aufruf()).status).toBe(403);
    expect(mocks.ladeEinstellungen).not.toHaveBeenCalled();
  });

  it("Member bekommt 200 mit firmen null", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, workspaceRole: "member" });
    const res = await aufruf();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.firmen).toBeNull();
    expect(body.data.apiSchluessel).toBeNull();
    expect(mocks.ladeEinstellungen).toHaveBeenCalledWith({ workspaceId: "ws1", userId: "u1", workspaceRole: "member" });
  });

  it("Admin bekommt 200 mit Firmen", async () => {
    mocks.getAuthContext.mockResolvedValue(ADMIN);
    const res = await aufruf();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.admin).toBe(true);
    expect(body.data.firmen).toEqual([]);
  });
});
