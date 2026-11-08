import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  buchungAendern: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/einsatz-buchungen", () => ({
  buchungAendern: mocks.buchungAendern,
}));

import { PATCH } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const p = { params: Promise.resolve({ id: "b1" }) };
const anfrage = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/einsatz/buchungen/b1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.buchungAendern.mockResolvedValue({ buchung: { id: "b1" }, warnungen: [] });
});

describe("PATCH /api/v1/einsatz/buchungen/[id]", () => {
  it.each(["read", "full"] as const)("API-Schlüssel %s → 403 NUR_MENSCH", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: zugriff });
    const res = await PATCH(anfrage({ notiz: "x" }), p);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NUR_MENSCH");
    expect(mocks.buchungAendern).not.toHaveBeenCalled();
  });

  it("fehlt im Workspace → 404", async () => {
    mocks.buchungAendern.mockResolvedValue(null);
    expect((await PATCH(anfrage({ notiz: "x" }), p)).status).toBe(404);
  });

  it("storniert → 409", async () => {
    mocks.buchungAendern.mockResolvedValue({ fehler: "BUCHUNG_STORNIERT" });
    const res = await PATCH(anfrage({ notiz: "x" }), p);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BUCHUNG_STORNIERT");
  });

  it("ungültiger Zeitraum → 400", async () => {
    mocks.buchungAendern.mockResolvedValue({ fehler: "ZEITRAUM_UNGUELTIG" });
    const res = await PATCH(anfrage({ bis: "2026-01-01" }), p);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("ZEITRAUM_UNGUELTIG");
  });

  it("gibt Buchung und Warnungen zurück", async () => {
    const res = await PATCH(anfrage({ mieteCent: 50000, firmaId: "andere" }), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { buchung: { id: "b1" }, warnungen: [] } });
    expect(mocks.buchungAendern).toHaveBeenCalledWith("ws_1", "b1", { mieteCent: 50000, firmaId: "andere" }, "usr_1");
  });
});
