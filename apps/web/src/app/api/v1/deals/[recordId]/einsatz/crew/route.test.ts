import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ctx: null as null | Record<string, unknown>, imWs: true, setzen: vi.fn() }));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: async () => m.ctx }));
vi.mock("@/lib/kalkulation-versionen-antwort", () => ({ dealImWorkspace: async () => m.imWs }));
vi.mock("@/services/crew/ausschreibung", async (orig) => ({
  ...(await orig<typeof import("@/services/crew/ausschreibung")>()),
  crewAusschreibungSetzen: m.setzen,
}));
vi.mock("@/services/records", () => ({ updateRecord: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

const { PATCH } = await import("./route");
const params = { params: Promise.resolve({ recordId: "d1" }) };
const req = (body: unknown) => new NextRequest("http://x/api/v1/deals/d1/einsatz/crew", { method: "PATCH", body: JSON.stringify(body) });
const wert = { auftragId: "au1", leute: 4, ausKalkulation: 4, ausschreiben: true };

describe("PATCH /api/v1/deals/[recordId]/einsatz/crew", () => {
  beforeEach(() => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.imWs = true;
    m.setzen.mockReset().mockResolvedValue({ ok: true, wert });
  });

  it("API-Schlüssel 403 NUR_MENSCH, ohne Sitzung 401, fremder Deal 404; nie geschrieben", async () => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "api_key", apiKeyAccess: "full" };
    expect((await PATCH(req({ leute: 4 }), params)).status).toBe(403);
    m.ctx = null;
    expect((await PATCH(req({ leute: 4 }), params)).status).toBe(401);
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.imWs = false;
    expect((await PATCH(req({ leute: 4 }), params)).status).toBe(404);
    expect(m.setzen).not.toHaveBeenCalled();
  });

  it("400 bei ungültigem Body", async () => {
    for (const b of [{}, { leute: 0 }, { leute: "4" }, { ausschreiben: 1 }]) expect((await PATCH(req(b), params)).status).toBe(400);
    expect(m.setzen).not.toHaveBeenCalled();
  });

  it("speichert mit Autor aus der Sitzung; 409 ohne Auftrag", async () => {
    const r = await PATCH(req({ leute: 4, ausschreiben: true }), params);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual(wert);
    expect(m.setzen).toHaveBeenCalledWith("w1", "d1", { leute: 4, ausschreiben: true }, "u1");
    m.setzen.mockResolvedValueOnce({ ok: false, code: "KEIN_AUFTRAG" });
    expect((await PATCH(req({ leute: 2 }), params)).status).toBe(409);
  });
});
