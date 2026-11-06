import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ladeGespraech: vi.fn(),
  markConversationRead: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
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
vi.mock("@/services/gespraech", () => ({ ladeGespraech: mocks.ladeGespraech }));
vi.mock("@/services/inbox", () => ({ markConversationRead: mocks.markConversationRead }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const get = () => new NextRequest("http://localhost/api/v1/deals/deal_1/gespraech");

const kanal = (gespraechId: string, direkt: boolean) => ({
  gespraechId,
  kanal: "whatsapp" as const,
  name: "Kottke WhatsApp",
  kontoId: "acc_1",
  istWaba: true,
  telefon: "+4915100000001",
  kundeName: "Familie Weber",
  direkt,
  kannSenden: direkt,
  imFenster: true,
});

const GESPRAECH = {
  eintraege: [
    { art: "system", id: "sys:lead", zeit: "2026-11-01T08:00:00.000Z", text: "Lead angelegt · Neue Anfrage", betont: "Neue Anfrage" },
    {
      art: "nachricht",
      id: "m1",
      zeit: "2026-11-02T09:00:00.000Z",
      richtung: "inbound",
      kanal: "whatsapp",
      gespraechId: "c_wa",
      von: "Familie Weber",
      text: "Hallo",
      status: "received",
      anhaenge: [],
    },
  ],
  kanaele: [kanal("c_wa", true), kanal("c_mail", true), kanal("c_fremd", false)],
  vorauswahl: "c_wa",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.ladeGespraech.mockResolvedValue(GESPRAECH);
  mocks.markConversationRead.mockResolvedValue(undefined);
});

describe("GET /deals/[recordId]/gespraech", () => {
  it("ohne Anmeldung 401, nichts gelesen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), { params })).status).toBe(401);
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
    expect(mocks.ladeGespraech).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen, nichts markiert", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.ladeGespraech).not.toHaveBeenCalled();
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("liefert { eintraege, kanaele, vorauswahl } und markiert nur direkt verknüpfte Gespräche als gelesen", async () => {
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(GESPRAECH);
    expect(mocks.ladeGespraech).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.markConversationRead.mock.calls).toEqual([
      ["c_wa", "ws_1"],
      ["c_mail", "ws_1"],
    ]);
  });

  it("Deal ohne Gespräch: 200, nichts markiert", async () => {
    mocks.ladeGespraech.mockResolvedValue({ eintraege: [GESPRAECH.eintraege[0]], kanaele: [], vorauswahl: null });
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ eintraege: [GESPRAECH.eintraege[0]], kanaele: [], vorauswahl: null });
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("Nur-Lese-Schlüssel: liest, markiert nichts", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect(mocks.ladeGespraech).toHaveBeenCalled();
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("voller API-Schlüssel markiert wie die Sitzung", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    await GET(get(), { params });
    expect(mocks.markConversationRead).toHaveBeenCalledTimes(2);
  });

  it("Fehler beim Gelesen-Markieren nur loggen, Antwort bleibt 200", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.markConversationRead.mockRejectedValueOnce(new Error("db weg"));
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.vorauswahl).toBe("c_wa");
    expect(mocks.markConversationRead).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
