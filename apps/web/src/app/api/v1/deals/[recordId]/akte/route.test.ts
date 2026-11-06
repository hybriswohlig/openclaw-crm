import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ladeAkte: vi.fn(),
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
vi.mock("@/services/akte", () => ({ ladeAkte: mocks.ladeAkte }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const get = () => new NextRequest("http://localhost/api/v1/deals/deal_1/akte");

const AKTE = {
  kopf: {
    name: "Familie Weber",
    art: "Umzug, 3 Zimmer",
    strecke: "Stuttgart-West nach Esslingen",
    meta: "Über Kleinanzeigen · Kottke · Lead seit Di 03.11.",
    team: [{ kuerzel: "MK", name: "Max Kottke" }],
    stufe: { id: "st_angebot", label: "Angebot", kategorie: "quoted", ton: "gold" },
    stufen: [{ id: "st_angebot", label: "Angebot", kategorie: "quoted" }],
    verlustGruende: [{ id: "lr_preis", label: "Zu teuer" }],
  },
  kacheln: [
    { key: "kv", label: "Kostenvoranschlag", wert: "2.480 €", zeile: "v2 · gesendet Mi 04.11." },
    { key: "marge", label: "Marge", wert: "38 %", zeile: "Selbstkosten 1.540 €" },
    { key: "termin", label: "Termin", wert: "Sa 21.11.", zeile: "in 16 Tagen" },
    { key: "volumen", label: "Volumen", wert: "38 m³", zeile: "aus 14 Fotos und Chat" },
    { key: "team", label: "Team", wert: "3 · Sprinter L", zeile: "Fahrt 1,2 h · Arbeit 5,5 h" },
    { key: "wartet", label: "Wartet auf Kunden", wert: "2 Tage", zeile: "KV 3× geöffnet", ton: "grau" },
  ],
  ablauf: { schritte: [], position: 4 },
  nachfass: { an: true, modus: "entwurf", text: "automatisch, als Entwurf" },
  dock: { primaer: { aktion: "nachricht_schreiben", label: "Nachricht schreiben" }, abErlaubt: false, rechnungErlaubt: false, bewertungErlaubt: false },
  zahlung: { restCent: 248000, meldungen: [] },
  firma: { id: "oc_kottke", name: "Kottke" },
  altLink: "/objects/deals/deal_1",
  kalkulationLink: "/app/leads/deal_1/kalkulation",
  kvLink: "/app/leads/deal_1/kalkulation",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.ladeAkte.mockResolvedValue(AKTE);
});

describe("GET /deals/[recordId]/akte", () => {
  it("ohne Anmeldung 401, nichts gelesen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), { params })).status).toBe(401);
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
    expect(mocks.ladeAkte).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.ladeAkte).not.toHaveBeenCalled();
  });

  it("liefert AkteDaten in { data }", async () => {
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual(AKTE);
    expect(Object.keys(data).sort()).toEqual(["ablauf", "altLink", "dock", "firma", "kacheln", "kalkulationLink", "kopf", "kvLink", "nachfass", "zahlung"]);
    expect(data.kacheln).toHaveLength(6);
    expect(mocks.ladeAkte).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Nur-Lese-Schlüssel darf lesen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await GET(get(), { params })).status).toBe(200);
  });
});
