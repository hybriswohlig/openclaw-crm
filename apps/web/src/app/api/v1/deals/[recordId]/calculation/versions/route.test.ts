import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  liste: vi.fn(),
  entwurfHolenOderAnlegen: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
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
vi.mock("@/services/kalkulation-versionen-speicher", () => ({
  dbVersionsSpeicher: { liste: mocks.liste, lesen: vi.fn() },
}));
vi.mock("@/services/kalkulation-versionen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kalkulation-versionen")>();
  return { ...actual, entwurfHolenOderAnlegen: mocks.entwurfHolenOderAnlegen };
});

import { GET, POST } from "./route";
import { VersionsFehler } from "@/services/kalkulation-versionen";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const req = (method: "GET" | "POST", body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const zeile = (version: number, status: "entwurf" | "gesperrt") => ({
  id: `v${version}`,
  workspaceId: "ws_1",
  dealRecordId: "deal_1",
  version,
  status,
  priceCents: 149000,
  lockedAt: status === "gesperrt" ? "2026-11-05T10:00:00.000Z" : null,
  sentAt: null,
  sentVia: null,
  tariff: { id: "t1", version: 2, marke: "ceylan" },
  error: null,
  rechnerRequest: { von_etage: "1" },
  rechnerResult: { preis: { festpreis: 1490 } },
  costLines: [{ key: "personal.arbeit" }],
  overrides: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.liste.mockResolvedValue([zeile(1, "gesperrt"), zeile(2, "entwurf")]);
  mocks.entwurfHolenOderAnlegen.mockResolvedValue({ version: zeile(2, "entwurf"), neu: true });
});

describe("GET /calculation/versions", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(req("GET"), { params })).status).toBe(401);
    expect((await POST(req("POST"), { params })).status).toBe(401);
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Deal nicht gefunden.");
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.liste).not.toHaveBeenCalled();
  });

  it("Liste ohne Schnappschüsse des Rechners", async () => {
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(mocks.liste).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(data.versionen).toEqual([
      { version: 1, status: "gesperrt", priceCents: 149000, lockedAt: "2026-11-05T10:00:00.000Z", sentAt: null, sentVia: null, tariff: { id: "t1", version: 2, marke: "ceylan" }, error: null },
      { version: 2, status: "entwurf", priceCents: 149000, lockedAt: null, sentAt: null, sentVia: null, tariff: { id: "t1", version: 2, marke: "ceylan" }, error: null },
    ]);
    expect(JSON.stringify(data)).not.toContain("rechnerRequest");
    expect(JSON.stringify(data)).not.toContain("rechnerResult");
  });

  it("Nur-Lese-Schlüssel: GET liest nur, legt keinen Entwurf an", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(200);
    expect(mocks.entwurfHolenOderAnlegen).not.toHaveBeenCalled();
  });
});

describe("POST /calculation/versions", () => {
  it("Entwurf holen oder anlegen, Autor Mensch bei Sitzung", async () => {
    const res = await POST(req("POST"), { params });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.neu).toBe(true);
    expect(data.version.version).toBe(2);
    expect(mocks.entwurfHolenOderAnlegen).toHaveBeenCalledWith("ws_1", "deal_1", { userId: "usr_1", quelle: "mensch" });
  });

  it("API-Schlüssel: Autor agent, ein Autor im Body zählt nicht", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    await POST(req("POST", { autor: { userId: "usr_x", quelle: "mensch" } }), { params });
    expect(mocks.entwurfHolenOderAnlegen).toHaveBeenCalledWith("ws_1", "deal_1", { userId: "usr_1", quelle: "agent" });
  });

  it("Deal aus fremdem Workspace → 404, kein Entwurf", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await POST(req("POST"), { params })).status).toBe(404);
    expect(mocks.entwurfHolenOderAnlegen).not.toHaveBeenCalled();
  });

  it("VersionsFehler mit Status und Code", async () => {
    mocks.entwurfHolenOderAnlegen.mockRejectedValue(new VersionsFehler("UNGUELTIG", "Bitte erneut versuchen."));
    const res = await POST(req("POST"), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "UNGUELTIG", message: "Bitte erneut versuchen." });
  });
});
