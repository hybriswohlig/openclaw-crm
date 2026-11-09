import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ctx: null as null | Record<string, unknown>,
  imWs: true,
  laden: vi.fn(),
}));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: async () => m.ctx }));
vi.mock("@/lib/kalkulation-versionen-antwort", () => ({ dealImWorkspace: async () => m.imWs }));
vi.mock("@/services/einsatz-karte", () => ({ ladeEinsatzKarte: m.laden }));

const { GET } = await import("./route");
const params = { params: Promise.resolve({ recordId: "d1" }) };
const req = () => new NextRequest("http://x/api/v1/deals/d1/einsatz/karte");

describe("/api/v1/deals/[recordId]/einsatz/karte", () => {
  beforeEach(() => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.imWs = true;
    m.laden.mockReset().mockResolvedValue({ personen: [], hinweise: [], linie: [], beladen: null, entladen: null });
  });

  it("API-Schlüssel full und read: 403 NUR_MENSCH, ohne Dienstaufruf", async () => {
    for (const access of ["full", "read"]) {
      m.laden.mockClear();
      m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "api_key", apiKeyAccess: access };
      const r = await GET(req(), params);
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("NUR_MENSCH");
      expect(m.laden).not.toHaveBeenCalled();
    }
  });

  it("fremder Deal 404, ohne Dienstaufruf", async () => {
    m.imWs = false;
    expect((await GET(req(), params)).status).toBe(404);
    expect(m.laden).not.toHaveBeenCalled();
  });

  it("200 reicht Workspace und Deal durch", async () => {
    const r = await GET(req(), params);
    expect(r.status).toBe(200);
    expect(m.laden).toHaveBeenCalledWith("w1", "d1");
  });
});
