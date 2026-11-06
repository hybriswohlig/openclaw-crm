import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeLeadsSpalte: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/leads-board", () => ({ ladeLeadsSpalte: mocks.ladeLeadsSpalte, SPALTE_LIMIT_MAX: 400 }));

import { LEERER_FILTER } from "@/lib/leads-board";
import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "member" as const, authMethod: "cookie" as const };
const get = (query = "") => new NextRequest(`http://localhost/api/v1/leads/board/spalte${query}`);
const SEITE = { stufeId: "s1", karten: [], weiter: null, anzahl: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeLeadsSpalte.mockResolvedValue(SEITE);
});

describe("GET /leads/board/spalte", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get("?stufe=s1"))).status).toBe(401);
    expect(mocks.ladeLeadsSpalte).not.toHaveBeenCalled();
  });

  it("ohne stufe 400", async () => {
    for (const q of ["", "?stufe=", "?stufe=%20"]) {
      const res = await GET(get(q));
      expect(res.status).toBe(400);
    }
    expect(mocks.ladeLeadsSpalte).not.toHaveBeenCalled();
  });

  it("ungültiger offset oder limit 400", async () => {
    for (const q of ["?stufe=s1&offset=-1", "?stufe=s1&offset=abc", "?stufe=s1&limit=0", "?stufe=s1&limit=1.5", "?stufe=s1&limit=x"]) {
      expect((await GET(get(q))).status, q).toBe(400);
    }
    expect(mocks.ladeLeadsSpalte).not.toHaveBeenCalled();
  });

  it("liefert { data: LeadsSpaltenSeite }; Standard offset 0 und limit 40, limit höchstens 400", async () => {
    const res = await GET(get("?stufe=s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SEITE });
    expect(mocks.ladeLeadsSpalte).toHaveBeenLastCalledWith("ws_1", LEERER_FILTER, "s1", 0, 40);

    await GET(get("?stufe=_ohne&offset=40&limit=80&q=Weber&alle=1"));
    expect(mocks.ladeLeadsSpalte).toHaveBeenLastCalledWith("ws_1", { ...LEERER_FILTER, suche: "Weber", endstufen: true }, "_ohne", 40, 80);

    await GET(get("?stufe=s1&limit=9999"));
    expect(mocks.ladeLeadsSpalte).toHaveBeenLastCalledWith("ws_1", LEERER_FILTER, "s1", 0, 400);
  });
});
