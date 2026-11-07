import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  sperren: vi.fn(),
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
vi.mock("@/services/kalkulation-versionen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kalkulation-versionen")>();
  return { ...actual, sperren: mocks.sperren };
});

import { POST } from "./route";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2/lock", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = (version = "2") => ({ params: Promise.resolve({ recordId: "deal_1", version }) });
const ERGEBNIS = {
  version: { id: "v2", version: 2, status: "gesperrt" },
  quotation: { id: "q1", fixedPrice: "1490.00" },
  gueltigkeitHinweis: "Umzug in 3 Tagen: Angebot gilt bis zum Umzugstag.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.sperren.mockResolvedValue(ERGEBNIS);
});

describe("POST /calculation/versions/[version]/lock", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(req(), p())).status).toBe(401);
  });

  it("Deal aus fremdem Workspace → 404, nichts gesperrt", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await POST(req(), p());
    expect(res.status).toBe(404);
    expect(mocks.sperren).not.toHaveBeenCalled();
  });

  it("Version nicht numerisch → 400", async () => {
    expect((await POST(req(), p("zwei"))).status).toBe(400);
    expect(mocks.sperren).not.toHaveBeenCalled();
  });

  it("sperrt (leerer Body), Antwort { version, quotation, gueltigkeitHinweis }", async () => {
    const res = await POST(req(), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(ERGEBNIS);
    expect(mocks.sperren).toHaveBeenCalledWith("ws_1", "deal_1", 2, { userId: "usr_1", quelle: "mensch" }, { bestaetigtSpanne: false });
  });

  it("bestaetigtSpanne nur bei true; API-Schlüssel → Autor agent", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    await POST(req({ bestaetigtSpanne: true }), p());
    expect(mocks.sperren).toHaveBeenLastCalledWith("ws_1", "deal_1", 2, { userId: "usr_1", quelle: "agent" }, { bestaetigtSpanne: true });
    await POST(req({ bestaetigtSpanne: "ja" }), p());
    expect(mocks.sperren.mock.calls[1][4]).toEqual({ bestaetigtSpanne: false });
  });

  it("erwartetPreisCent wird durchgereicht; fehlt es, bleibt es weg (alte Karte, MCP)", async () => {
    await POST(req({ erwartetPreisCent: 248000 }), p());
    expect(mocks.sperren).toHaveBeenLastCalledWith("ws_1", "deal_1", 2, { userId: "usr_1", quelle: "mensch" }, {
      bestaetigtSpanne: false, erwartetPreisCent: 248000,
    });
    await POST(req({ bestaetigtSpanne: true }), p());
    expect(mocks.sperren.mock.calls[1][4]).toEqual({ bestaetigtSpanne: true });
  });

  it("Plan 5b: erwartetPreisHash und modusWechselBestaetigt werden durchgereicht, sonst fehlen sie", async () => {
    await POST(req({ erwartetPreisHash: "-@-=149000|basis@-=129000", modusWechselBestaetigt: true }), p());
    expect(mocks.sperren).toHaveBeenLastCalledWith("ws_1", "deal_1", 2, { userId: "usr_1", quelle: "mensch" }, {
      bestaetigtSpanne: false, erwartetPreisHash: "-@-=149000|basis@-=129000", modusWechselBestaetigt: true,
    });
    // Nur true bestätigt den Wechsel vom Stunden-KV zum Festpreis.
    await POST(req({ modusWechselBestaetigt: "ja" }), p());
    expect(mocks.sperren.mock.calls[1][4]).toEqual({ bestaetigtSpanne: false });
  });

  it.each([[""], [42], [null]])("erwartetPreisHash %s → 400, nichts gesperrt", async (wert) => {
    const res = await POST(req({ erwartetPreisHash: wert }), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("erwartetPreisHash muss ein Text sein.");
    expect(mocks.sperren).not.toHaveBeenCalled();
  });

  it.each([[-1], [12.5], ["248000"], [null]])("erwartetPreisCent %s → 400, nichts gesperrt", async (wert) => {
    const res = await POST(req({ erwartetPreisCent: wert }), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("erwartetPreisCent muss eine ganze Zahl in Cent sein.");
    expect(mocks.sperren).not.toHaveBeenCalled();
  });

  it("Preis beim Neurechnen geändert → 409 PREIS_GEAENDERT", async () => {
    mocks.sperren.mockRejectedValue(
      new VersionsFehler("PREIS_GEAENDERT", "Der Preis hat sich beim Neurechnen geändert. Bitte prüfen und erneut sperren.")
    );
    const res = await POST(req({ erwartetPreisCent: 248000 }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: "PREIS_GEAENDERT", message: "Der Preis hat sich beim Neurechnen geändert. Bitte prüfen und erneut sperren.",
    });
  });

  it("VersionsFehler PAKETE → 409 mit code PAKETE", async () => {
    mocks.sperren.mockRejectedValue(new VersionsFehler("PAKETE", "Dieser Lead hat Paketoptionen."));
    const res = await POST(req(), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: "PAKETE", message: "Dieser Lead hat Paketoptionen." });
  });

  it.each([
    ["RECHNER_FEHLER", 409],
    ["STUNDEN", 409],
    ["SPANNE", 409],
    ["UNGUELTIG", 400],
    ["NICHT_GEFUNDEN", 404],
    ["UEBERSTEUERUNG_VERWAIST", 409],
    // Plan 5b: die neuen Ablehnungen beim Sperren (eine Regel mit der Kalkulationsseite).
    ["KERN_NEGATIV", 409],
    ["PAKET_OHNE_PREIS", 409],
    ["PAKET_OHNE_HEBEL", 409],
    ["ANZAHLUNG_UEBER_PREIS", 409],
    ["STUNDEN_NUR_MENSCH", 409],
    ["STUNDEN_ZUSATZ_VPS", 409],
    ["MODUSWECHSEL", 409],
    ["TAGESPREIS_NUR_MENSCH", 409],
  ] as const)("VersionsFehler %s → %i", async (code, status) => {
    mocks.sperren.mockRejectedValue(new VersionsFehler(code, "x"));
    const res = await POST(req(), p());
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("Kundenannahme → 409 KVA_ACCEPTED", async () => {
    mocks.sperren.mockRejectedValue(new AngebotAngenommenError());
    const res = await POST(req(), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("KVA_ACCEPTED");
  });

  it("unbekannter Fehler wird weitergeworfen", async () => {
    mocks.sperren.mockRejectedValue(new Error("DB weg"));
    await expect(POST(req(), p())).rejects.toThrow("DB weg");
  });
});
