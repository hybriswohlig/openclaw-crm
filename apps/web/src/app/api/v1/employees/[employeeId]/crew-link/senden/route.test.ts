import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ctx: null as null | Record<string, unknown>, senden: vi.fn() }));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: async () => m.ctx }));
vi.mock("@/services/crew/link-senden", () => ({ crewLinkSenden: m.senden }));

const { POST } = await import("./route");
const params = { params: Promise.resolve({ employeeId: "e1" }) };
const req = () => new NextRequest("http://x/api/v1/employees/e1/crew-link/senden", { method: "POST" });
const link = { url: "http://localhost:3100/l/x", createdAt: "", revokedAt: null, lastSeenAt: null, viewCount: 0, aktiv: true };

describe("POST /api/v1/employees/[employeeId]/crew-link/senden", () => {
  beforeEach(() => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.senden.mockReset().mockResolvedValue({ ok: true, an: "+491512345678", link });
  });

  it("API-Schlüssel 403 NUR_MENSCH ohne Versand; ohne Sitzung 401", async () => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "api_key", apiKeyAccess: "full" };
    const r = await POST(req(), params);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("NUR_MENSCH");
    m.ctx = null;
    expect((await POST(req(), params)).status).toBe(401);
    expect(m.senden).not.toHaveBeenCalled();
  });

  it("gesendet: 200 mit Nummer und Link, Autor aus der Sitzung", async () => {
    const r = await POST(req(), params);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ an: "+491512345678", link });
    expect(m.senden).toHaveBeenCalledWith("w1", "e1", "u1");
  });

  it("Fehlercodes auf Status", async () => {
    for (const [code, status] of [["KEIN_TELEFON", 409], ["GESPERRT", 409], ["INAKTIV", 409], ["NICHT_GEFUNDEN", 404], ["KEIN_ABSENDER", 503]] as const) {
      m.senden.mockResolvedValueOnce({ ok: false, code });
      const r = await POST(req(), params);
      expect(r.status, code).toBe(status);
      expect((await r.json()).error.code).toBe(code);
    }
    m.senden.mockResolvedValueOnce({ ok: false, code: "VERSAND", message: "bridge returned 500" });
    const r = await POST(req(), params);
    expect(r.status).toBe(502);
    expect((await r.json()).error.message).toContain("bridge returned 500");
  });
});
