import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  lesen: vi.fn(),
  routeLesen: vi.fn(),
  routeSchreiben: vi.fn(),
}));

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
vi.mock("@/services/kalkulation-versionen-speicher", () => ({
  dbVersionsSpeicher: { liste: vi.fn(), lesen: mocks.lesen },
}));
vi.mock("@/services/kalkulations-route-speicher", () => ({
  dbRoutenSpeicher: async () => ({ lesen: mocks.routeLesen, schreiben: mocks.routeSchreiben }),
}));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = () => new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2/route-karte");
const p = (version: string) => ({ params: Promise.resolve({ recordId: "deal_1", version }) });
const STATION = "Löwentorstraße 12, 70376 Stuttgart";
const VERSION = {
  id: "ver_2",
  version: 2,
  status: "entwurf",
  rechnerRequest: { von_adresse: "Heilbronner Str. 339, 70469 Stuttgart", nach_adresse: "Hauptstr. 5, 73728 Esslingen" },
  rechnerResult: { mietstation: { adresse: STATION }, stationsVergleich: [{}, {}] },
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "maps_key");
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.lesen.mockResolvedValue(VERSION);
  mocks.routeLesen.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /calculation/versions/[version]/route-karte", () => {
  it("ohne Anmeldung 401, fremder Deal 404, falsche Version 400, unbekannte 404", async () => {
    mocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(req(), p("2"))).status).toBe(401);
    mocks.dealImWorkspace.mockResolvedValueOnce(false);
    expect((await GET(req(), p("2"))).status).toBe(404);
    expect((await GET(req(), p("x"))).status).toBe(400);
    mocks.lesen.mockResolvedValueOnce(null);
    expect((await GET(req(), p("9"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("liefert die Route in genau der Form", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ routes: [{ legs: [
      { distanceMeters: 9000, duration: "960s", polyline: { encodedPolyline: "a" } },
      { distanceMeters: 23000, duration: "1800s", polyline: { encodedPolyline: "b" } },
      { distanceMeters: 16000, duration: "1500s", polyline: { encodedPolyline: "c" } },
    ] }] })));
    const res = await GET(req(), p("2"));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(Object.keys(data).sort()).toEqual(["gesamtKm", "gesamtMinuten", "googleLink", "stationen", "status", "teilstrecken"]);
    expect(data).toMatchObject({ status: "ok", stationen: 2, gesamtKm: 48, gesamtMinuten: 71 });
    expect(data.teilstrecken[1]).toEqual({ von: "Beladen", nach: "Entladen", km: 23, minuten: 30, polyline: "b", haupt: true });
    expect(mocks.lesen).toHaveBeenCalledWith("ws_1", "deal_1", 2);
    expect(mocks.routeLesen).toHaveBeenCalledWith("ws_1", "ver_2");
    expect(mocks.routeSchreiben).toHaveBeenCalledTimes(1);
  });

  it("Nur-Lesen-Schlüssel: kein Google-Abruf, nichts gespeichert", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(req(), p("2"));
    expect((await res.json()).data.status).toBe("nicht_geladen");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.routeSchreiben).not.toHaveBeenCalled();
  });

  it("ohne Beladeadresse: ungenau, kein Abruf (Review Focus 1; Plan 15: ein Ort allein reicht für eine ungefähre Route)", async () => {
    mocks.lesen.mockResolvedValue({ ...VERSION, rechnerRequest: {} });
    const data = (await (await GET(req(), p("2"))).json()).data;
    expect(data).toEqual({ status: "ungenau", teilstrecken: [], googleLink: null, stationen: 2, gesamtKm: null, gesamtMinuten: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 der Routes API: nicht_freigegeben mit 200", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }));
    const res = await GET(req(), p("2"));
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("nicht_freigegeben");
    expect(mocks.routeSchreiben).not.toHaveBeenCalled();
  });
});
