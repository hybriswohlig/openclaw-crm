import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ladeKurzfassung: vi.fn(),
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
vi.mock("@/services/kurzfassung", () => ({ ladeKurzfassung: mocks.ladeKurzfassung }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const get = () => new NextRequest("http://localhost/api/v1/deals/deal_1/kurzfassung");

const KURZ = {
  dealId: "deal_1",
  name: "Familie Weber",
  stufe: { id: "st_angebot", label: "Angebot", ton: "gold" },
  zeilen: [
    { label: "Kostenvoranschlag", wert: "2.480 € · v2", ton: null },
    { label: "Umzugsdatum", wert: "Sa 21.11.", ton: null },
    { label: "Volumen", wert: "38 m³", ton: null },
    { label: "Marge", wert: "38 %", ton: null },
    { label: "Wartet", wert: "auf Kunden · 2 Tage", ton: null },
  ],
  naechsterSchritt: { titel: "Annahme", zusatz: "im Status-Link · Nachfass Tag 2 morgen" },
  kunde: { telefon: "+49 171 2345678", email: "weber@example.de", von: "Rotebühlstr. 112, 70178 Stuttgart", nach: "Esslingen", quelle: "Kleinanzeigen", firma: "Kottke" },
  gespraech: { kanaele: "WhatsApp, 2 Anrufe", fotos: 14, dokumente: "KV v1, v2" },
  nachfass: { an: true, modus: "entwurf", text: "automatisch · Entwurf" },
  keinLeadStufeId: "st_kein",
  kategorie: "quoted",
  akteLink: "/app/leads/deal_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.ladeKurzfassung.mockResolvedValue(KURZ);
});

describe("GET /deals/[recordId]/kurzfassung", () => {
  it("ohne Anmeldung 401, nichts gelesen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), { params })).status).toBe(401);
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
    expect(mocks.ladeKurzfassung).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NOT_FOUND", message: "Deal nicht gefunden." });
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.ladeKurzfassung).not.toHaveBeenCalled();
  });

  it("liefert { data: Kurzfassung }", async () => {
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(KURZ);
    expect(mocks.ladeKurzfassung).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Nur-Lese-Schlüssel darf lesen (die Route schreibt nichts)", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.dealId).toBe("deal_1");
  });
});
