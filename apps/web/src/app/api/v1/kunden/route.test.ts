import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeKundenListe: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, {
    get(_t, p) {
      if (p === "then" || typeof p === "symbol") return undefined;
      throw new Error(`@/db im Test (${String(p)})`);
    },
  }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/kunden", () => ({ ladeKundenListe: mocks.ladeKundenListe }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const, permissions: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeKundenListe.mockResolvedValue({ ansicht: "kunden", suche: "leer", zeilen: [], ohneKunde: [], weiter: null });
});

describe("GET /api/v1/kunden", () => {
  it("API-Schlüssel bekommt 403 und liest nichts", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key" });
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden"));
    expect(res.status).toBe(403);
    expect(mocks.ladeKundenListe).not.toHaveBeenCalled();
  });

  it("Sitzung liest mit der Workspace-Id", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden?ansicht=anfragen&q=Sommer&weiter=p9"));
    expect(res.status).toBe(200);
    expect(mocks.ladeKundenListe).toHaveBeenCalledWith("ws_1", { ansicht: "anfragen", q: "Sommer", weiter: "p9" });
  });

  it("ohne Ansicht gilt Kunden, unbekannte Ansicht 400", async () => {
    await GET(new NextRequest("http://localhost/api/v1/kunden"));
    expect(mocks.ladeKundenListe).toHaveBeenCalledWith("ws_1", { ansicht: "kunden", q: "", weiter: null });
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden?ansicht=alle"));
    expect(res.status).toBe(400);
  });

  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/v1/kunden"));
    expect(res.status).toBe(401);
    expect(mocks.ladeKundenListe).not.toHaveBeenCalled();
  });
});
