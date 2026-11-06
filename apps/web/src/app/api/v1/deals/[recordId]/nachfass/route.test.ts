import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ladeNachfassSchalter: vi.fn(),
  setzeNachfassSchalter: vi.fn(),
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
vi.mock("@/services/nachfass-schalter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/nachfass-schalter")>();
  return {
    ...actual,
    ladeNachfassSchalter: mocks.ladeNachfassSchalter,
    setzeNachfassSchalter: mocks.setzeNachfassSchalter,
  };
});

import { GET, PUT } from "./route";
import { NachfassSchalterFehler } from "@/services/nachfass-schalter";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const URL_ = "http://localhost/api/v1/deals/deal_1/nachfass";
const get = () => new NextRequest(URL_);
const put = (body?: unknown) =>
  new NextRequest(URL_, {
    method: "PUT",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const STAND = {
  an: true,
  modus: "entwurf",
  text: "automatisch, Entwurf zur Freigabe",
  regeln: [
    { tag: 2, gesendetAm: null, geplantAm: "2026-11-04T09:00:00.000Z", art: "entwurf" },
    { tag: 7, gesendetAm: null, geplantAm: "2026-11-09T09:00:00.000Z", art: "entwurf" },
    { tag: 10, gesendetAm: null, geplantAm: "2026-11-12T09:00:00.000Z", art: "entwurf" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.ladeNachfassSchalter.mockResolvedValue(STAND);
  mocks.setzeNachfassSchalter.mockResolvedValue({ ...STAND, an: false, modus: "aus", text: "aus" });
});

describe("GET /deals/[recordId]/nachfass", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), p())).status).toBe(401);
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(get(), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.ladeNachfassSchalter).not.toHaveBeenCalled();
  });

  it("liefert den Schalterstand als { data }", async () => {
    const res = await GET(get(), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(STAND);
    expect(mocks.ladeNachfassSchalter).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Nur-Lesen-API-Schlüssel darf lesen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await GET(get(), p())).status).toBe(200);
  });
});

describe("PUT /deals/[recordId]/nachfass", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await PUT(put({ an: true }), p())).status).toBe(401);
  });

  it("Nur-Lesen-API-Schlüssel → 403, nichts gesetzt", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await PUT(put({ an: false }), p());
    expect(res.status).toBe(403);
    expect(mocks.setzeNachfassSchalter).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gesetzt", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await PUT(put({ an: false }), p());
    expect(res.status).toBe(404);
    expect(mocks.setzeNachfassSchalter).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ an: "ja" }], [{ an: 1 }], [null], ["kein json"]])("Body %j → 400", async (body) => {
    const res = await PUT(put(body), p());
    expect(res.status).toBe(400);
    expect(mocks.setzeNachfassSchalter).not.toHaveBeenCalled();
  });

  it("setzt mit Benutzer aus dem Kontext und gibt den neuen Stand zurück", async () => {
    const res = await PUT(put({ an: false }), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ an: false, modus: "aus", text: "aus" });
    expect(mocks.setzeNachfassSchalter).toHaveBeenCalledWith("ws_1", "deal_1", false, "usr_1");
  });

  it.each([true, false])("Sequenz beendet (an = %s) → 409 BEENDET", async (an) => {
    mocks.setzeNachfassSchalter.mockRejectedValue(
      new NachfassSchalterFehler("BEENDET", "Die Nachfass-Sequenz ist für diesen Deal beendet.")
    );
    const res = await PUT(put({ an }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: "BEENDET",
      message: "Die Nachfass-Sequenz ist für diesen Deal beendet.",
    });
  });

  it("unbekannter Fehler wird weitergeworfen", async () => {
    mocks.setzeNachfassSchalter.mockRejectedValue(new Error("DB weg"));
    await expect(PUT(put({ an: true }), p())).rejects.toThrow("DB weg");
  });

  it("voller API-Schlüssel darf setzen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    expect((await PUT(put({ an: true }), p())).status).toBe(200);
    expect(mocks.setzeNachfassSchalter).toHaveBeenCalledWith("ws_1", "deal_1", true, "usr_1");
  });
});
