import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  zuordnen: vi.fn(),
  loesen: vi.fn(),
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
vi.mock("@/services/einsatz-buchungen", () => ({
  zuordnen: mocks.zuordnen,
  loesen: mocks.loesen,
}));

import { DELETE, PUT } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const p = { params: Promise.resolve({ id: "b1", dealId: "deal_1" }) };
const anfrage = (method: "PUT" | "DELETE") =>
  new NextRequest("http://localhost/api/v1/einsatz/buchungen/b1/deals/deal_1", { method });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.zuordnen.mockResolvedValue({ ok: true, warnungen: ["Hinweis"] });
  mocks.loesen.mockResolvedValue(true);
});

describe("PUT/DELETE /api/v1/einsatz/buchungen/[id]/deals/[dealId]", () => {
  it.each(["read", "full"] as const)("API-Schlüssel %s → 403 NUR_MENSCH auf PUT und DELETE", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: zugriff });
    for (const methode of ["PUT", "DELETE"] as const) {
      const res = methode === "PUT" ? await PUT(anfrage("PUT"), p) : await DELETE(anfrage("DELETE"), p);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("NUR_MENSCH");
    }
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
    expect(mocks.zuordnen).not.toHaveBeenCalled();
    expect(mocks.loesen).not.toHaveBeenCalled();
  });

  it("fremder Deal → 404", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await PUT(anfrage("PUT"), p)).status).toBe(404);
    expect((await DELETE(anfrage("DELETE"), p)).status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.zuordnen).not.toHaveBeenCalled();
    expect(mocks.loesen).not.toHaveBeenCalled();
  });

  it("falsche Firma → 409", async () => {
    mocks.zuordnen.mockResolvedValue({ ok: false, code: "FALSCHE_FIRMA" });
    const res = await PUT(anfrage("PUT"), p);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("FALSCHE_FIRMA");
  });

  it("stornierte Buchung → 409", async () => {
    mocks.zuordnen.mockResolvedValue({ ok: false, code: "BUCHUNG_STORNIERT" });
    const res = await PUT(anfrage("PUT"), p);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BUCHUNG_STORNIERT");
  });

  it("Buchung fehlt → 404, Zuordnung liefert Warnungen", async () => {
    mocks.zuordnen.mockResolvedValueOnce(null);
    expect((await PUT(anfrage("PUT"), p)).status).toBe(404);
    mocks.zuordnen.mockResolvedValueOnce({ ok: true, warnungen: ["Hinweis"] });
    const res = await PUT(anfrage("PUT"), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { warnungen: ["Hinweis"] } });
    expect(mocks.zuordnen).toHaveBeenCalledWith("ws_1", "b1", "deal_1", "usr_1");
  });

  it("DELETE löst die Zuordnung", async () => {
    const res = await DELETE(anfrage("DELETE"), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { geloest: true } });
    expect(mocks.loesen).toHaveBeenCalledWith("ws_1", "deal_1");
  });
});
