import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  adresseInsLead: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/kalkulation-adresse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kalkulation-adresse")>();
  return { ...actual, adresseInsLead: mocks.adresseInsLead };
});

import { PUT } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/adresse", { method: "PUT", body: JSON.stringify(body) });
const p = { params: Promise.resolve({ recordId: "deal_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.adresseInsLead.mockResolvedValue(undefined);
});

describe("PUT /calculation/adresse (Plan 15)", () => {
  const gut = { seite: "beladen", adresse: "70372 Stuttgart", quelle: "chat", version: 2 };
  it("401 ohne Anmeldung, 403 Nur-Lesen, 404 fremder Deal", async () => {
    mocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await PUT(req(gut), p)).status).toBe(401);
    mocks.getAuthContext.mockResolvedValueOnce({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await PUT(req(gut), p)).status).toBe(403);
    mocks.dealImWorkspace.mockResolvedValueOnce(false);
    expect((await PUT(req(gut), p)).status).toBe(404);
    expect(mocks.adresseInsLead).not.toHaveBeenCalled();
  });
  it("400 bei ungültiger Eingabe", async () => {
    expect((await PUT(req({ seite: "oben", adresse: "x" }), p)).status).toBe(400);
  });
  it("schreibt mit Nutzer und Quelle", async () => {
    const res = await PUT(req(gut), p);
    expect(res.status).toBe(200);
    expect(mocks.adresseInsLead).toHaveBeenCalledWith("ws_1", "deal_1", { seite: "beladen", adresse: "70372 Stuttgart", quelle: "chat", version: 2 }, "usr_1");
  });
});
