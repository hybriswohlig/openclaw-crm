import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  bestaetigeZahlungsmeldung: vi.fn(),
  verwerfeZahlungsmeldung: vi.fn(),
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
vi.mock("@/services/zahlungsmeldungen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/zahlungsmeldungen")>();
  return {
    ...actual,
    bestaetigeZahlungsmeldung: mocks.bestaetigeZahlungsmeldung,
    verwerfeZahlungsmeldung: mocks.verwerfeZahlungsmeldung,
  };
});

import { POST } from "./route";
import { ZahlungsmeldungFehler } from "@/services/zahlungsmeldungen";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const post = (body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/payment-reports/e1", {
    method: "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = (eventId = "e1") => ({ params: Promise.resolve({ recordId: "deal_1", eventId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.bestaetigeZahlungsmeldung.mockResolvedValue({ paymentId: "pay_1" });
  mocks.verwerfeZahlungsmeldung.mockResolvedValue(undefined);
});

describe("POST /deals/[recordId]/payment-reports/[eventId]", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(post({ aktion: "bestaetigen" }), p())).status).toBe(401);
  });

  it("Nur-Lesen-Schlüssel → 403, nichts geschrieben", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await POST(post({ aktion: "bestaetigen" }), p());
    expect(res.status).toBe(403);
    expect(mocks.bestaetigeZahlungsmeldung).not.toHaveBeenCalled();
  });

  it("voller API-Schlüssel darf nicht bestätigen (403), verwerfen bleibt", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    const res = await POST(post({ aktion: "bestaetigen" }), p());
    expect(res.status).toBe(403);
    expect(mocks.bestaetigeZahlungsmeldung).not.toHaveBeenCalled();
    expect((await POST(post({ aktion: "verwerfen" }), p())).status).toBe(200);
  });

  it("Deal aus fremdem Workspace → 404, nichts geschrieben", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await POST(post({ aktion: "bestaetigen" }), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.bestaetigeZahlungsmeldung).not.toHaveBeenCalled();
  });

  it("ungültige Aktion oder kaputter Body → 400", async () => {
    expect((await POST(post({ aktion: "loeschen" }), p())).status).toBe(400);
    expect((await POST(post("{kaputt"), p())).status).toBe(400);
    expect((await POST(post(), p())).status).toBe(400);
    expect(mocks.bestaetigeZahlungsmeldung).not.toHaveBeenCalled();
    expect(mocks.verwerfeZahlungsmeldung).not.toHaveBeenCalled();
  });

  it("bestaetigen → { paymentId }", async () => {
    const res = await POST(post({ aktion: "bestaetigen" }), p());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { paymentId: "pay_1" } });
    expect(mocks.bestaetigeZahlungsmeldung).toHaveBeenCalledWith("ws_1", "deal_1", "e1", "usr_1");
  });

  it("verwerfen → { verworfen: true }", async () => {
    const res = await POST(post({ aktion: "verwerfen" }), p());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { verworfen: true } });
    expect(mocks.verwerfeZahlungsmeldung).toHaveBeenCalledWith("ws_1", "deal_1", "e1", "usr_1");
  });

  it("fremde eventId → 404 NICHT_GEFUNDEN", async () => {
    mocks.bestaetigeZahlungsmeldung.mockRejectedValue(new ZahlungsmeldungFehler("NICHT_GEFUNDEN", "Meldung nicht gefunden."));
    const res = await POST(post({ aktion: "bestaetigen" }), p("evt_fremd"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NICHT_GEFUNDEN");
    expect(mocks.bestaetigeZahlungsmeldung).toHaveBeenCalledWith("ws_1", "deal_1", "evt_fremd", "usr_1");
  });

  it("schon erledigt → 409 ERLEDIGT", async () => {
    mocks.verwerfeZahlungsmeldung.mockRejectedValue(new ZahlungsmeldungFehler("ERLEDIGT", "Meldung ist schon erledigt."));
    const res = await POST(post({ aktion: "verwerfen" }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ERLEDIGT");
  });

  it("andere Fehler werden nicht verschluckt", async () => {
    mocks.bestaetigeZahlungsmeldung.mockRejectedValue(new Error("db weg"));
    await expect(POST(post({ aktion: "bestaetigen" }), p())).rejects.toThrow("db weg");
  });
});
