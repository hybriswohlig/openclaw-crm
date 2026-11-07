import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createOfferPackage: vi.fn(),
  listOfferPackages: vi.fn(),
  updateOfferPackage: vi.fn(),
  deleteOfferPackage: vi.fn(),
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
  createOfferPackage: mocks.createOfferPackage,
  listOfferPackages: mocks.listOfferPackages,
  updateOfferPackage: mocks.updateOfferPackage,
  deleteOfferPackage: mocks.deleteOfferPackage,
  operatingCompanyInWorkspace: mocks.operatingCompanyInWorkspace,
}));

import { POST } from "./route";
import { PATCH } from "./[packageId]/route";

const ADMIN = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/v1/customer-portal-settings/oc_kottke/packages", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const pOc = { params: Promise.resolve({ ocId: "oc_kottke" }) };
const pPaket = { params: Promise.resolve({ ocId: "oc_kottke", packageId: "pkg_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(ADMIN);
  mocks.operatingCompanyInWorkspace.mockResolvedValue(true);
  mocks.createOfferPackage.mockImplementation(async (_ws, _oc, input) => ({ id: "pkg_neu", ...input }));
  mocks.updateOfferPackage.mockImplementation(async (_ws, _oc, id, patch) => ({ id, ...patch }));
});

describe("POST …/packages: Hebel je Paket (Plan 5b, F6)", () => {
  it("legt mit Hebeln in fester Reihenfolge ohne Doppel an", async () => {
    const res = await POST(req("POST", { slug: "premium", displayName: "Premium", hebel: ["kueche", "montage", "kueche", "halteverbot", "einpacken"] }), pOc);
    expect(res.status).toBe(201);
    expect(mocks.createOfferPackage).toHaveBeenCalledWith("ws_1", "oc_kottke", {
      slug: "premium",
      displayName: "Premium",
      hebel: ["halteverbot", "montage", "einpacken", "kueche"],
    });
  });

  it("unbekannter Hebel oder keine Liste → 400", async () => {
    for (const hebel of [["sauna"], "montage", [1]]) {
      expect((await POST(req("POST", { slug: "x", displayName: "X", hebel }), pOc)).status).toBe(400);
    }
    expect(mocks.createOfferPackage).not.toHaveBeenCalled();
  });

  it("Firma eines fremden Workspace → 404, nichts angelegt", async () => {
    mocks.operatingCompanyInWorkspace.mockResolvedValue(false);
    expect((await POST(req("POST", { slug: "basis", displayName: "Basis" }), pOc)).status).toBe(404);
    expect(mocks.operatingCompanyInWorkspace).toHaveBeenCalledWith("ws_1", "oc_kottke");
    expect(mocks.createOfferPackage).not.toHaveBeenCalled();
  });

  it("nur Admins", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, workspaceRole: "member" });
    expect((await POST(req("POST", { slug: "basis", displayName: "Basis" }), pOc)).status).toBe(403);
  });
});

describe("PATCH …/packages/[packageId]: Hebel", () => {
  it("ändert die Hebel im Workspace des Nutzers", async () => {
    const res = await PATCH(req("PATCH", { hebel: ["montage", "halteverbot"] }), pPaket);
    expect(res.status).toBe(200);
    expect(mocks.updateOfferPackage).toHaveBeenCalledWith("ws_1", "oc_kottke", "pkg_1", { hebel: ["halteverbot", "montage"] });
  });

  it("leere Liste ist erlaubt (Basis: nur Kern)", async () => {
    await PATCH(req("PATCH", { hebel: [] }), pPaket);
    expect(mocks.updateOfferPackage).toHaveBeenCalledWith("ws_1", "oc_kottke", "pkg_1", { hebel: [] });
  });

  it("ohne `hebel` bleiben sie unberührt", async () => {
    await PATCH(req("PATCH", { active: false }), pPaket);
    expect(mocks.updateOfferPackage).toHaveBeenCalledWith("ws_1", "oc_kottke", "pkg_1", { active: false });
  });

  it("ungültig → 400; fremdes Paket → 404", async () => {
    expect((await PATCH(req("PATCH", { hebel: ["dach"] }), pPaket)).status).toBe(400);
    expect(mocks.updateOfferPackage).not.toHaveBeenCalled();
    mocks.updateOfferPackage.mockResolvedValue(null);
    expect((await PATCH(req("PATCH", { hebel: [] }), pPaket)).status).toBe(404);
  });
});
