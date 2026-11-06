import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  bewertungsVorschau: vi.fn(),
  bewertungAnfragen: vi.fn(),
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
vi.mock("@/services/bewertung-anfragen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/bewertung-anfragen")>();
  return { ...actual, bewertungsVorschau: mocks.bewertungsVorschau, bewertungAnfragen: mocks.bewertungAnfragen };
});

import { GET, POST } from "./route";
import {
  BewertungFehler,
  BewertungKonfigFehler,
  BewertungVersandFehler,
  type BewertungCode,
} from "@/services/bewertung-anfragen";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const URL_ = "http://localhost/api/v1/deals/deal_1/review-request";
const get = () => new NextRequest(URL_);
const post = (body?: unknown) =>
  new NextRequest(URL_, {
    method: "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const VORSCHAU = { text: "Hallo Anna,\n…", kanal: "Kottke WhatsApp", einwilligung: true, sperre: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.bewertungsVorschau.mockResolvedValue(VORSCHAU);
  mocks.bewertungAnfragen.mockResolvedValue({ gesendet: true, gespraechId: "conv_1" });
});

describe("GET /deals/[recordId]/review-request", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), p())).status).toBe(401);
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(get(), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.bewertungsVorschau).not.toHaveBeenCalled();
  });

  it("liefert die Vorschau als { data }", async () => {
    const res = await GET(get(), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(VORSCHAU);
    expect(mocks.bewertungsVorschau).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Nur-Lesen-API-Schlüssel darf die Vorschau lesen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await GET(get(), p())).status).toBe(200);
  });
});

describe("POST /deals/[recordId]/review-request", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(post({}), p())).status).toBe(401);
  });

  it("Nur-Lesen-API-Schlüssel → 403, nichts gesendet", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await POST(post({}), p());
    expect(res.status).toBe(403);
    expect(mocks.bewertungAnfragen).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gesendet", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await POST(post({}), p());
    expect(res.status).toBe(404);
    expect(mocks.bewertungAnfragen).not.toHaveBeenCalled();
  });

  it("sendet mit Benutzer, Text und Einwilligung", async () => {
    const res = await POST(post({ text: "Hallo", einwilligung: "Am Telefon am 03.11." }), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ gesendet: true, gespraechId: "conv_1" });
    expect(mocks.bewertungAnfragen).toHaveBeenCalledWith("ws_1", "deal_1", {
      userId: "usr_1",
      text: "Hallo",
      einwilligung: "Am Telefon am 03.11.",
    });
  });

  it("leerer Body: Vorlage, keine Einwilligung", async () => {
    expect((await POST(post(), p())).status).toBe(200);
    expect(mocks.bewertungAnfragen).toHaveBeenCalledWith("ws_1", "deal_1", { userId: "usr_1" });
  });

  it.each([[{ text: 3 }], [{ einwilligung: false }], [[1, 2]], ["kein json"]])("Body %j → 400", async (body) => {
    const res = await POST(post(body), p());
    expect(res.status).toBe(400);
    expect(mocks.bewertungAnfragen).not.toHaveBeenCalled();
  });

  it.each<BewertungCode>(["STUFE", "KEIN_LINK", "SPERRE", "EINWILLIGUNG", "KEIN_KANAL", "FENSTER", "RUHEZEIT", "SCHON_GESENDET"])(
    "%s → 409 mit code und deutschem Text",
    async (code) => {
      const fehler = new BewertungFehler(code);
      mocks.bewertungAnfragen.mockRejectedValue(fehler);
      const res = await POST(post({}), p());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toEqual({ code, message: fehler.message });
      expect(fehler.message).toMatch(/[a-zäöü]/);
    }
  );

  it("TEXT → 400 mit code", async () => {
    mocks.bewertungAnfragen.mockRejectedValue(new BewertungFehler("TEXT", "Der Text muss den STOP-Hinweis enthalten."));
    const res = await POST(post({ text: "x" }), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "TEXT", message: "Der Text muss den STOP-Hinweis enthalten." });
  });

  it("fehlende NEXT_PUBLIC_APP_URL → 500 mit klarem Text", async () => {
    mocks.bewertungAnfragen.mockRejectedValue(new BewertungKonfigFehler("NEXT_PUBLIC_APP_URL fehlt"));
    const res = await POST(post({}), p());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toEqual({ code: "KONFIGURATION", message: "NEXT_PUBLIC_APP_URL fehlt" });
  });

  it("Senden unklar → 502 VERSAND_UNKLAR mit dem Hinweis", async () => {
    mocks.bewertungAnfragen.mockRejectedValue(new BewertungVersandFehler("VERSAND_UNKLAR", new Error("x")));
    const res = await POST(post({}), p());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({
      code: "VERSAND_UNKLAR",
      message: "Senden unklar. Bitte im Gespräch prüfen, bevor erneut gesendet wird.",
    });
  });

  it("nachweislich nicht gesendet → 502 NICHT_GESENDET", async () => {
    mocks.bewertungAnfragen.mockRejectedValue(new BewertungVersandFehler("NICHT_GESENDET", new Error("x")));
    const res = await POST(post({}), p());
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("NICHT_GESENDET");
  });

  it("unbekannter Fehler wird weitergeworfen", async () => {
    mocks.bewertungAnfragen.mockRejectedValue(new Error("Bridge weg"));
    await expect(POST(post({}), p())).rejects.toThrow("Bridge weg");
  });
});
