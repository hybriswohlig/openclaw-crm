import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  setzen: vi.fn(),
  schalter: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (o) => ({ ...(await o<typeof import("@/lib/api-utils")>()), getAuthContext: mocks.getAuthContext }));
vi.mock("@/lib/kalkulation-versionen-antwort", async (o) => ({
  ...(await o<typeof import("@/lib/kalkulation-versionen-antwort")>()),
  dealImWorkspace: mocks.dealImWorkspace,
}));
vi.mock("@/services/plan5-schalter", () => ({ paketeAnbietenSetzen: mocks.setzen, paketSchalter: mocks.schalter }));
vi.mock("@/services/activity-events", () => ({ emitEvent: vi.fn() }));

import { GET, PUT } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/pakete", { method: body ? "PUT" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
const p = { params: Promise.resolve({ recordId: "deal_1" }) };
const ZUSTAND = { firma: false, deal: "an", wirksam: true, pakete: { aktiv: 3, basis: true } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.schalter.mockResolvedValue(ZUSTAND);
});

describe("Pakete anbieten je Deal (Plan 15, Bauteil 15)", () => {
  it("GET liefert den Zustand, fremder Deal 404", async () => {
    expect((await (await GET(req(), p)).json()).data).toEqual(ZUSTAND);
    mocks.dealImWorkspace.mockResolvedValueOnce(false);
    expect((await GET(req(), p)).status).toBe(404);
  });
  it("PUT: an, aus, standard (null); Unsinn 400", async () => {
    await PUT(req({ wert: "an" }), p);
    await PUT(req({ wert: "standard" }), p);
    expect(mocks.setzen.mock.calls).toEqual([["deal_1", "an"], ["deal_1", null]]);
    expect((await PUT(req({ wert: "ja" }), p)).status).toBe(400);
  });
  it("API-Schlüssel 403, auch mit Schreibrecht", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "write" });
    expect((await PUT(req({ wert: "an" }), p)).status).toBe(403);
    expect(mocks.setzen).not.toHaveBeenCalled();
  });
});
