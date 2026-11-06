import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeInboxListe: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/inbox-neu", () => ({ ladeInboxListe: mocks.ladeInboxListe }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const get = (query = "") => new NextRequest(`http://localhost/api/v1/inbox/liste${query}`);

const LISTE = {
  eintraege: [
    {
      key: "deal:d1",
      dealId: "d1",
      gespraechIds: ["c1"],
      name: "Familie Weber",
      kuerzel: "FW",
      kanal: "whatsapp",
      kanaele: ["whatsapp"],
      kleinanzeigen: false,
      vorschau: "Hallo",
      vorschauPraefix: null,
      zeit: "2026-11-06T10:00:00.000Z",
      zeitText: "11:00",
      ungelesen: 1,
      wartet: { auf: "uns", seit: "2026-11-06T10:00:00.000Z", text: "wartet auf uns · 1 Std" },
      kiEntwurf: null,
      stufe: { id: "s1", label: "Neue Anfrage", ton: "blau" },
      gruppe: "haupt",
      laneText: null,
      firma: { id: "f1", name: "Kottke" },
    },
  ],
  chips: { ungelesen: 1, wartenAufUns: 1, kiEntwuerfe: 0, infoKeinLead: 0 },
  firmen: [{ id: "f1", name: "Kottke" }],
  stufen: [{ id: "s1", label: "Neue Anfrage" }],
  abgeschnitten: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeInboxListe.mockResolvedValue(LISTE);
});

describe("GET /inbox/liste", () => {
  it("ohne Anmeldung 401, nichts geladen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mocks.ladeInboxListe).not.toHaveBeenCalled();
  });

  it("liefert { data: InboxListe } für den eigenen Workspace", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: LISTE });
    expect(mocks.ladeInboxListe).toHaveBeenCalledWith("ws_1", { suche: undefined });
  });

  it("q ab 2 Zeichen geht getrimmt an den Server, kürzer lädt die ganze Liste", async () => {
    await GET(get("?q=%20Weber%20"));
    expect(mocks.ladeInboxListe).toHaveBeenLastCalledWith("ws_1", { suche: "Weber" });
    await GET(get("?q=W"));
    expect(mocks.ladeInboxListe).toHaveBeenLastCalledWith("ws_1", { suche: undefined });
    await GET(get("?q=%20%20"));
    expect(mocks.ladeInboxListe).toHaveBeenLastCalledWith("ws_1", { suche: undefined });
  });
});
