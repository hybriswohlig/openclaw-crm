import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeLeadsBoard: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/leads-board", () => ({ ladeLeadsBoard: mocks.ladeLeadsBoard }));

import { LEERER_FILTER } from "@/lib/leads-board";
import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const get = (query = "") => new NextRequest(`http://localhost/api/v1/leads/board${query}`);

const BOARD = {
  firmen: [{ id: "f1", name: "Kottke", farbe: "#222224" }],
  quellen: [{ id: "q1", label: "WhatsApp" }],
  stufen: [{ id: "s1", label: "Neue Anfrage", kategorie: "open_new" }],
  verlustGruende: [],
  spalten: [
    {
      stufeId: "s1",
      label: "Neue Anfrage",
      kategorie: "open_new",
      ton: "blau",
      satz: "Wartet auf erste Antwort",
      anzahl: 0,
      summeCent: null,
      summeGeschaetzt: false,
      karten: [],
      weiter: null,
      eingeklappt: false,
    },
  ],
  chips: { warten: 0, kv_ungesehen: 0, ohne_team: 0, rechnung_offen: 0, ohne_ab: 0, diese_woche: 0 },
  stand: "2026-11-06T11:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeLeadsBoard.mockResolvedValue(BOARD);
});

describe("GET /leads/board", () => {
  it("ohne Anmeldung 401, nichts geladen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mocks.ladeLeadsBoard).not.toHaveBeenCalled();
  });

  it("liefert { data: LeadsBoard } für den eigenen Workspace, ohne Parameter mit leerem Filter", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: BOARD });
    expect(mocks.ladeLeadsBoard).toHaveBeenCalledWith("ws_1", LEERER_FILTER);
  });

  it("Filter aus der URL, Ungültiges fällt weg", async () => {
    await GET(get("?chip=warten&firma=f1&quelle=q1&monat=2026-11&q=Weber&nur=uns&alle=1"));
    expect(mocks.ladeLeadsBoard).toHaveBeenLastCalledWith("ws_1", {
      chip: "warten",
      firmaId: "f1",
      quelleId: "q1",
      monat: "2026-11",
      suche: "Weber",
      nurWartet: true,
      endstufen: true,
    });
    await GET(get("?chip=kaputt&monat=2026-13&nur=ja&alle=0"));
    expect(mocks.ladeLeadsBoard).toHaveBeenLastCalledWith("ws_1", LEERER_FILTER);
  });
});
