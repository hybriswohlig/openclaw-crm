import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getOperatingCompanyPortalSettings: vi.fn(),
  upsertOperatingCompanyPortalSettings: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/customer-portal-config", () => ({
  getOperatingCompanyPortalSettings: mocks.getOperatingCompanyPortalSettings,
  upsertOperatingCompanyPortalSettings: mocks.upsertOperatingCompanyPortalSettings,
}));

import { GET, PUT } from "./route";

const ADMIN = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const p = { params: Promise.resolve({ ocId: "oc_kottke" }) };
const put = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/customer-portal-settings/oc_kottke", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(ADMIN);
  mocks.upsertOperatingCompanyPortalSettings.mockImplementation(async (_ws, oc, patch) => ({ operatingCompanyRecordId: oc, ...patch }));
});

describe("PUT /customer-portal-settings/[ocId]: Schalter Plan 5b", () => {
  it("nimmt beide Schalter an und reicht sie mit Workspace weiter", async () => {
    const res = await PUT(put({ angebotAusKalkulation: true, tagespreiseEnabled: true }), p);
    expect(res.status).toBe(200);
    expect(mocks.upsertOperatingCompanyPortalSettings).toHaveBeenCalledWith("ws_1", "oc_kottke", {
      angebotAusKalkulation: true,
      tagespreiseEnabled: true,
    });
  });

  it("kein Boolean → 400, nichts gespeichert", async () => {
    for (const body of [{ angebotAusKalkulation: "ja" }, { tagespreiseEnabled: 1 }, { tagespreiseEnabled: null }]) {
      const res = await PUT(put(body), p);
      expect(res.status).toBe(400);
    }
    expect(mocks.upsertOperatingCompanyPortalSettings).not.toHaveBeenCalled();
  });

  it("nur Admins", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, workspaceRole: "member" });
    expect((await PUT(put({ angebotAusKalkulation: true }), p)).status).toBe(403);
    expect(mocks.upsertOperatingCompanyPortalSettings).not.toHaveBeenCalled();
  });

  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await PUT(put({ angebotAusKalkulation: true }), p)).status).toBe(401);
  });

  it("Firma nicht im Workspace → 404", async () => {
    mocks.upsertOperatingCompanyPortalSettings.mockResolvedValue(null);
    expect((await PUT(put({ angebotAusKalkulation: true }), p)).status).toBe(404);
    mocks.getOperatingCompanyPortalSettings.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/x"), p)).status).toBe(404);
  });
});
