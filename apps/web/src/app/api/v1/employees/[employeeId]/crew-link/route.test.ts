import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ctx: null as null | Record<string, unknown>,
  lesen: vi.fn(),
  anlegen: vi.fn(),
  erneuern: vi.fn(),
  sperren: vi.fn(),
}));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: async () => m.ctx }));
vi.mock("@/services/crew/links", () => ({
  crewLinkLesen: m.lesen,
  crewLinkAnlegen: m.anlegen,
  crewLinkErneuern: m.erneuern,
  crewLinkSperren: m.sperren,
}));

const { GET, POST, PATCH, DELETE } = await import("./route");
const params = { params: Promise.resolve({ employeeId: "e1" }) };
const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api/v1/employees/e1/crew-link", { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const link = { url: "http://localhost:3100/l/x", createdAt: "", revokedAt: null, lastSeenAt: null, viewCount: 0, aktiv: true };

describe("/api/v1/employees/[employeeId]/crew-link", () => {
  beforeEach(() => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    for (const f of [m.lesen, m.anlegen, m.erneuern, m.sperren]) f.mockReset().mockResolvedValue({ ok: true, link });
  });

  it("API-Schlüssel 403 NUR_MENSCH für jede Methode, ohne Dienst", async () => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "api_key", apiKeyAccess: "full" };
    for (const r of [await GET(req("GET"), params), await POST(req("POST"), params), await PATCH(req("PATCH", { neu: true }), params), await DELETE(req("DELETE"), params)]) {
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("NUR_MENSCH");
    }
    for (const f of [m.lesen, m.anlegen, m.erneuern, m.sperren]) expect(f).not.toHaveBeenCalled();
  });

  it("ohne Sitzung 401", async () => {
    m.ctx = null;
    expect((await GET(req("GET"), params)).status).toBe(401);
  });

  it("anlegen 201 bei neuem Link, Autor aus der Sitzung; 409 für Inaktive; 404 unbekannt", async () => {
    m.anlegen.mockResolvedValueOnce({ ok: true, link, neu: true });
    let r = await POST(req("POST"), params);
    expect(r.status).toBe(201);
    expect((await r.json()).data.url).toBe(link.url);
    expect(m.anlegen).toHaveBeenCalledWith("w1", "e1", "u1");
    m.anlegen.mockResolvedValueOnce({ ok: false, code: "INAKTIV" });
    r = await POST(req("POST"), params);
    expect(r.status).toBe(409);
    m.lesen.mockResolvedValueOnce({ ok: false, code: "NICHT_GEFUNDEN" });
    expect((await GET(req("GET"), params)).status).toBe(404);
  });

  it("erneuern nur mit { neu: true }", async () => {
    expect((await PATCH(req("PATCH", {}), params)).status).toBe(400);
    expect(m.erneuern).not.toHaveBeenCalled();
    expect((await PATCH(req("PATCH", { neu: true }), params)).status).toBe(200);
    m.erneuern.mockResolvedValueOnce({ ok: true, link: null });
    expect((await PATCH(req("PATCH", { neu: true }), params)).status).toBe(404);
  });

  it("sperren", async () => {
    const r = await DELETE(req("DELETE"), params);
    expect(r.status).toBe(200);
    expect(m.sperren).toHaveBeenCalledWith("w1", "e1");
  });
});
