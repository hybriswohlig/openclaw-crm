import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeKasse: vi.fn(),
  betriebsfirmaImWorkspace: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/kasse", () => ({
  ladeKasse: mocks.ladeKasse,
  betriebsfirmaImWorkspace: mocks.betriebsfirmaImWorkspace,
}));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const LESE_SCHLUESSEL = {
  userId: "usr_2",
  workspaceId: "ws_1",
  workspaceRole: "member" as const,
  authMethod: "api_key" as const,
  apiKeyAccess: "read" as const,
};
const ANTWORT = { schlangen: { meldung: [], ohne_rechnung: [], offen: [], anzahlung: [] }, summen: {}, stand: "2026-11-06T11:00:00.000Z" };

const get = (query = "") => new NextRequest(`http://localhost/api/v1/kasse${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.betriebsfirmaImWorkspace.mockResolvedValue(true);
  mocks.ladeKasse.mockResolvedValue(ANTWORT);
});

describe("GET /kasse", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mocks.ladeKasse).not.toHaveBeenCalled();
    expect(mocks.betriebsfirmaImWorkspace).not.toHaveBeenCalled();
  });

  it("fremde Firma 404", async () => {
    mocks.betriebsfirmaImWorkspace.mockResolvedValue(false);
    const res = await GET(get("?firma=oc_fremd"));
    expect(res.status).toBe(404);
    expect(mocks.betriebsfirmaImWorkspace).toHaveBeenCalledWith("ws_1", "oc_fremd");
    expect(mocks.ladeKasse).not.toHaveBeenCalled();
  });

  it("Nur-Lesen-Schlüssel darf lesen und die Firma wird durchgereicht", async () => {
    mocks.getAuthContext.mockResolvedValue(LESE_SCHLUESSEL);
    const res = await GET(get("?firma=oc_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ANTWORT });
    expect(mocks.ladeKasse).toHaveBeenCalledWith("ws_1", "oc_1");
  });

  it("ohne Firma lädt den ganzen Workspace", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(mocks.betriebsfirmaImWorkspace).not.toHaveBeenCalled();
    expect(mocks.ladeKasse).toHaveBeenCalledWith("ws_1", null);
  });
});
