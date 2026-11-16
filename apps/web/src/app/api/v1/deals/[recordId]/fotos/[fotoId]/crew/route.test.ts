import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ctx: null as null | Record<string, unknown>, imWs: true, freigeben: vi.fn() }));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: async () => m.ctx }));
vi.mock("@/lib/kalkulation-versionen-antwort", () => ({ dealImWorkspace: async () => m.imWs }));
vi.mock("@/services/crew/fotos", () => ({ crewFotoFreigeben: m.freigeben, FREIGABE_FORMAT_TEXT: "Nur JPEG, PNG, WebP oder GIF." }));

const { PATCH } = await import("./route");
const params = { params: Promise.resolve({ recordId: "d1", fotoId: "f1" }) };
const req = (body: unknown) => new NextRequest("http://x/api/v1/deals/d1/fotos/f1/crew", { method: "PATCH", body: JSON.stringify(body) });

describe("PATCH /api/v1/deals/[recordId]/fotos/[fotoId]/crew", () => {
  beforeEach(() => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.imWs = true;
    m.freigeben.mockReset().mockResolvedValue({ ok: true, crewFreigegebenAt: "2026-11-16T10:00:00.000Z" });
  });

  for (const access of ["full", "read"]) {
    it(`API-Schlüssel (${access}) 403 NUR_MENSCH, ohne Dienst`, async () => {
      m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "api_key", apiKeyAccess: access };
      const r = await PATCH(req({ freigegeben: true }), params);
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("NUR_MENSCH");
      expect(m.freigeben).not.toHaveBeenCalled();
    });
  }

  it("ohne Sitzung 401, fremder Deal 404, falscher Körper 400", async () => {
    m.ctx = null;
    expect((await PATCH(req({ freigegeben: true }), params)).status).toBe(401);
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.imWs = false;
    expect((await PATCH(req({ freigegeben: true }), params)).status).toBe(404);
    m.imWs = true;
    expect((await PATCH(req({ freigegeben: "ja" }), params)).status).toBe(400);
    expect(m.freigeben).not.toHaveBeenCalled();
  });

  it("Freigabe mit Autor aus der Sitzung; falsches Format 400 mit deutschem Text", async () => {
    const r = await PATCH(req({ freigegeben: true }), params);
    expect(r.status).toBe(200);
    expect(m.freigeben).toHaveBeenCalledWith("w1", "d1", "f1", true, "u1");
    m.freigeben.mockResolvedValueOnce({ ok: false, code: "FORMAT" });
    const f = await PATCH(req({ freigegeben: true }), params);
    expect(f.status).toBe(400);
    expect(await f.json()).toEqual({ error: { code: "FORMAT", message: "Nur JPEG, PNG, WebP oder GIF." } });
  });
});
