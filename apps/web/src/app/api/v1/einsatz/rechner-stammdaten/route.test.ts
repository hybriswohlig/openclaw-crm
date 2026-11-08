import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  rechnerStationen: vi.fn(),
  rechnerKlassen: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/rechner/stammdaten", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rechner/stammdaten")>();
  return { ...actual, rechnerStationen: mocks.rechnerStationen, rechnerKlassen: mocks.rechnerKlassen };
});

import { GET } from "./route";
import { RechnerStammdatenFehler } from "@/services/rechner/stammdaten";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const anfrage = () => new NextRequest("http://localhost/api/v1/einsatz/rechner-stammdaten");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.rechnerStationen.mockResolvedValue([{ id: "s1", name: "Sixt", anbieter: "Sixt", aktiv: true }]);
  mocks.rechnerKlassen.mockResolvedValue([]);
});

describe("GET /api/v1/einsatz/rechner-stammdaten", () => {
  it.each(["read", "full"] as const)("API-Schlüssel %s → 403 NUR_MENSCH", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: zugriff });
    const res = await GET(anfrage());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NUR_MENSCH");
    expect(mocks.rechnerStationen).not.toHaveBeenCalled();
  });

  it("Rechner nicht erreichbar → 502 mit Text", async () => {
    mocks.rechnerStationen.mockRejectedValue(new RechnerStammdatenFehler("Rechner nicht erreichbar."));
    const res = await GET(anfrage());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "RECHNER", message: "Rechner nicht erreichbar." } });
  });

  it("liefert Stationen und Klassen", async () => {
    const res = await GET(anfrage());
    expect(res.status).toBe(200);
    expect((await res.json()).data.stationen).toEqual([{ id: "s1", name: "Sixt", anbieter: "Sixt", aktiv: true }]);
  });
});
