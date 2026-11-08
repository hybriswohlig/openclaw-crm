import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ctx: null as null | Record<string, unknown>,
  imWs: true,
  laden: vi.fn(),
  bestaetigen: vi.fn(),
}));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: async () => m.ctx }));
vi.mock("@/lib/kalkulation-versionen-antwort", () => ({ dealImWorkspace: async () => m.imWs }));
vi.mock("@/services/einsatz", () => ({ ladeEinsatz: m.laden, einsatzBestaetigen: m.bestaetigen }));

const { GET, PUT } = await import("./route");
const params = { params: Promise.resolve({ recordId: "d1" }) };
const req = (method: string, body?: unknown, q = "") =>
  new NextRequest(`http://x/api/v1/deals/d1/einsatz${q}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const team = [{ employeeId: "e1", role: "lead", plannedDriveMinutes: 60, plannedWorkMinutes: null }];

describe("/api/v1/deals/[recordId]/einsatz", () => {
  beforeEach(() => {
    m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "cookie" };
    m.imWs = true;
    m.laden.mockReset().mockResolvedValue({ dealId: "d1" });
    m.bestaetigen.mockReset().mockResolvedValue({ ok: true, team: [] });
  });

  for (const access of ["full", "read"]) {
    it(`API-Schlüssel (${access}) 403 NUR_MENSCH, auch lesend`, async () => {
      m.ctx = { userId: "u1", workspaceId: "w1", workspaceRole: "admin", authMethod: "api_key", apiKeyAccess: access };
      for (const r of [await GET(req("GET"), params), await PUT(req("PUT", { team }), params)]) {
        expect(r.status).toBe(403);
        expect((await r.json()).error.code).toBe("NUR_MENSCH");
      }
      expect(m.laden).not.toHaveBeenCalled();
      expect(m.bestaetigen).not.toHaveBeenCalled();
    });
  }

  it("fremder Workspace 404", async () => {
    m.imWs = false;
    expect((await GET(req("GET"), params)).status).toBe(404);
    expect((await PUT(req("PUT", { team }), params)).status).toBe(404);
  });

  it("GET reicht frisch=1 durch", async () => {
    const r = await GET(req("GET", undefined, "?frisch=1"), params);
    expect(r.status).toBe(200);
    expect(m.laden).toHaveBeenCalledWith("w1", "d1", { frisch: true });
  });

  it("PUT mit falscher Form 400, ohne Dienst", async () => {
    for (const b of [null, { team: "x" }, { team: [{ employeeId: "e1", role: "chef" }] }, { team: [{ ...team[0], plannedDriveMinutes: "60" }] }]) {
      expect((await PUT(req("PUT", b), params)).status).toBe(400);
    }
    expect(m.bestaetigen).not.toHaveBeenCalled();
  });

  it("PUT reicht Team und bestaetigtAmTag durch, Autor aus der Sitzung", async () => {
    await PUT(req("PUT", { team, bestaetigtAmTag: ["e1"], autor: "boese" }), params);
    expect(m.bestaetigen).toHaveBeenCalledWith("w1", "d1", { team, bestaetigtAmTag: ["e1"] }, "u1");
  });

  it("Konflikte 409 mit Namen-Liste, formale Fehler 400", async () => {
    m.bestaetigen.mockResolvedValueOnce({ ok: false, code: "DOPPELT_AM_TAG", konflikte: [{ employeeId: "e1", tag: "2026-12-01", andere: [] }] });
    const r = await PUT(req("PUT", { team }), params);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatchObject({ code: "DOPPELT_AM_TAG", konflikte: [{ employeeId: "e1" }] });
    for (const [code, status] of [["STEMPELT_NOCH", 409], ["DOPPELTE_PERSON", 409], ["INAKTIV", 409], ["MEHR_ALS_EIN_LEAD", 400], ["MINUTEN_UNGUELTIG", 400]] as const) {
      m.bestaetigen.mockResolvedValueOnce({ ok: false, code });
      expect((await PUT(req("PUT", { team }), params)).status).toBe(status);
    }
  });
});
