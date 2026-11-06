import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeEinzelgespraech: vi.fn(),
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
vi.mock("@/services/gespraech", () => ({ ladeEinzelgespraech: mocks.ladeEinzelgespraech }));
vi.mock("@/services/inbox", () => ({ markConversationRead: mocks.markConversationRead }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ id: "c_info" });
const get = () => new NextRequest("http://localhost/api/v1/inbox/gespraeche/c_info");

const GESPRAECH = {
  eintraege: [
    {
      art: "nachricht",
      id: "m1",
      zeit: "2026-11-06T08:12:00.000Z",
      richtung: "inbound",
      kanal: "whatsapp",
      gespraechId: "c_info",
      von: "Herr Brandt",
      text: "Hallo, ist das noch aktuell?",
      status: "received",
      anhaenge: [],
    },
  ],
  kanaele: [
    {
      gespraechId: "c_info",
      kanal: "whatsapp",
      name: "Kottke WhatsApp",
      kontoId: "acc_1",
      istWaba: true,
      telefon: "+4917000000001",
      kundeName: "Herr Brandt",
      direkt: true,
      kannSenden: true,
      imFenster: true,
    },
  ],
  vorauswahl: "c_info",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeEinzelgespraech.mockResolvedValue(GESPRAECH);
  mocks.markConversationRead.mockResolvedValue(undefined);
});

describe("GET /inbox/gespraeche/[id]", () => {
  it("ohne Anmeldung 401, nichts gelesen, nichts markiert", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), { params })).status).toBe(401);
    expect(mocks.ladeEinzelgespraech).not.toHaveBeenCalled();
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("fremdes oder unbekanntes Gespräch → 404, nichts markiert", async () => {
    mocks.ladeEinzelgespraech.mockResolvedValue(null);
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NOT_FOUND", message: "Gespräch nicht gefunden." });
    expect(mocks.ladeEinzelgespraech).toHaveBeenCalledWith("ws_1", "c_info");
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("liefert { eintraege, kanaele, vorauswahl } und markiert das Gespräch gelesen", async () => {
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(GESPRAECH);
    expect(mocks.markConversationRead.mock.calls).toEqual([["c_info", "ws_1"]]);
  });

  it("Nur-Lese-Schlüssel: liest, markiert nichts", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect(mocks.ladeEinzelgespraech).toHaveBeenCalled();
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("voller API-Schlüssel markiert wie die Sitzung", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    await GET(get(), { params });
    expect(mocks.markConversationRead).toHaveBeenCalledTimes(1);
  });

  it("Fehler beim Gelesen-Markieren nur loggen, Antwort bleibt 200", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.markConversationRead.mockRejectedValueOnce(new Error("db weg"));
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.vorauswahl).toBe("c_info");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
