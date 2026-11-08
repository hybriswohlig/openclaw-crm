import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeLeadsListe: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/leads-board", () => ({ ladeLeadsListe: mocks.ladeLeadsListe }));

import { LEERER_FILTER } from "@/lib/leads-board";
import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "api_key" as const };
const get = (query = "") => new NextRequest(`http://localhost/api/v1/leads/liste${query}`);
const LISTE = {
  firmen: [],
  quellen: [],
  stufen: [],
  verlustGruende: [],
  zeilen: [],
  gesamt: 0,
  weiter: null,
  chips: { warten: 0, kv_ungesehen: 0, ohne_team: 0, rechnung_offen: 0, ohne_ab: 0, diese_woche: 0 },
  stand: "2026-11-06T11:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeLeadsListe.mockResolvedValue(LISTE);
});

describe("GET /leads/liste", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mocks.ladeLeadsListe).not.toHaveBeenCalled();
  });

  it("liefert { data: LeadsListe }; ohne Sortierung die Standard-Ansicht (Wartezeit, längste oben)", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: LISTE });
    expect(mocks.ladeLeadsListe).toHaveBeenCalledWith("ws_1", LEERER_FILTER, { schluessel: "wartezeit", richtung: "ab" }, 0);
  });

  it("sort, richtung, offset und Filter aus der URL; ungültige Sortierung fällt zurück", async () => {
    await GET(get("?sort=termin&richtung=auf&offset=50&quelle=q1&alle=1"));
    expect(mocks.ladeLeadsListe).toHaveBeenLastCalledWith(
      "ws_1",
      { ...LEERER_FILTER, quelleId: "q1", endstufen: true },
      { schluessel: "termin", richtung: "auf" },
      50,
    );
    await GET(get("?sort=name&richtung=auf"));
    expect(mocks.ladeLeadsListe).toHaveBeenLastCalledWith("ws_1", LEERER_FILTER, { schluessel: "wartezeit", richtung: "ab" }, 0);
  });

  it("ungültiger offset 400", async () => {
    for (const q of ["?offset=-5", "?offset=zehn", "?offset=1e3"]) {
      expect((await GET(get(q))).status, q).toBe(400);
    }
    expect(mocks.ladeLeadsListe).not.toHaveBeenCalled();
  });
});
