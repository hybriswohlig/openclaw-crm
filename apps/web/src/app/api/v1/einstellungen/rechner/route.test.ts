import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn(), ladeRechnerStammdaten: vi.fn() }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/rechner/stammdaten", () => ({ ladeRechnerStammdaten: mocks.ladeRechnerStammdaten }));

import { GET } from "./route";

const ADMIN = { userId: "u1", workspaceId: "ws1", workspaceRole: "admin" as const, permissions: {}, authMethod: "cookie" as const };
const aufruf = () => GET(new NextRequest("https://crm.test/api/v1/einstellungen/rechner"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ladeRechnerStammdaten.mockResolvedValue({ ok: false, fehler: "Rechner nicht erreichbar." });
});

describe("GET /api/v1/einstellungen/rechner", () => {
  it("401 ohne Anmeldung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await aufruf()).status).toBe(401);
  });

  it.each(["read", "full"])("403 für API-Schlüssel (%s), auch als Admin", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, authMethod: "api_key", apiKeyAccess: zugriff });
    expect((await aufruf()).status).toBe(403);
    expect(mocks.ladeRechnerStammdaten).not.toHaveBeenCalled();
  });

  it("403 für Member", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, workspaceRole: "member" });
    expect((await aufruf()).status).toBe(403);
    expect(mocks.ladeRechnerStammdaten).not.toHaveBeenCalled();
  });

  it("Admin bekommt 200 mit der Antwort des Dienstes (auch Fehler als Daten)", async () => {
    mocks.getAuthContext.mockResolvedValue(ADMIN);
    const res = await aufruf();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: false, fehler: "Rechner nicht erreichbar." });
  });
});
