import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  streetViewAdresse: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  zeilen: new Map<string, Record<string, unknown>>(),
  notizSetzen: vi.fn(),
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
vi.mock("@/services/street-view-adresse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/street-view-adresse")>();
  return { ...actual, streetViewAdresse: mocks.streetViewAdresse };
});
vi.mock("@vercel/blob", () => ({ put: mocks.put, get: mocks.get }));
vi.mock("@/services/street-view-speicher", () => ({
  dbStreetViewSpeicher: async () => ({
    lesen: async (ws: string, k: string) => mocks.zeilen.get(`${ws}|${k}`) ?? null,
    schreiben: async (z: Record<string, unknown>) => {
      mocks.zeilen.set(`${z.workspaceId}|${z.adresseSchluessel}`, { notiz: null, notizVonName: null, notizAm: null, ...z });
    },
    notizSetzen: mocks.notizSetzen,
  }),
}));

import { adresseGenau } from "@/lib/adresse-genau";
import { GET } from "./route";
import { GET as BILD } from "./bild/route";
import { PUT } from "./notiz/route";

const ADRESSE = "Heilbronner Str. 339, 70469 Stuttgart";
const KEY = adresseGenau(ADRESSE).schluessel!;
const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const NUR_LESEN = { ...CTX, authMethod: "api_key" as const, apiKeyAccess: "read" as const };
const p = { params: Promise.resolve({ recordId: "deal_1" }) };
const getReq = (q: string) => new NextRequest(`http://localhost/api/v1/deals/deal_1/street-view?${q}`);
const fetchMock = vi.fn();

function googleOk() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/streetview/metadata")) return new Response(JSON.stringify({ status: "OK", pano_id: "PANO_1" }));
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.zeilen.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("GOOGLE_STREETVIEW_API_KEY", "sv_key");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.streetViewAdresse.mockResolvedValue(ADRESSE);
  mocks.put.mockResolvedValue({ pathname: "x" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /deals/[recordId]/street-view", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(getReq("seite=beladen"), p)).status).toBe(401);
  });

  it("fremder Workspace → 404, kein Abruf", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await GET(getReq("seite=beladen"), p)).status).toBe(404);
    expect(mocks.streetViewAdresse).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ungültige seite oder Version → 400", async () => {
    expect((await GET(getReq("seite=oben"), p)).status).toBe(400);
    expect((await GET(getReq("seite=beladen&v=0"), p)).status).toBe(400);
  });

  it("unbekannte Version → 404", async () => {
    mocks.streetViewAdresse.mockResolvedValue(undefined);
    const res = await GET(getReq("seite=entladen&v=7"), p);
    expect(res.status).toBe(404);
    expect(mocks.streetViewAdresse).toHaveBeenCalledWith("ws_1", "deal_1", "entladen", 7);
  });

  it("holt, speichert und antwortet mit Bild-Link (k = Schlüssel)", async () => {
    googleOk();
    const res = await GET(getReq("seite=beladen"), p);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      status: "ok",
      bildUrl: `/api/v1/deals/deal_1/street-view/bild?seite=beladen&k=${KEY}`,
      panoLink: "https://www.google.com/maps/@?api=1&map_action=pano&pano=PANO_1",
      notiz: null,
      genau: true,
      adresse: ADRESSE,
    });
    expect(mocks.streetViewAdresse).toHaveBeenCalledWith("ws_1", "deal_1", "beladen", null);
    expect(mocks.zeilen.get(`ws_1|${KEY}`)?.status).toBe("ok");
  });

  it("ohne Schlüssel → 503 „Street View ist nicht eingerichtet.“ (Review Focus 4)", async () => {
    vi.stubEnv("GOOGLE_STREETVIEW_API_KEY", "");
    const res = await GET(getReq("seite=beladen"), p);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toEqual({ code: "NICHT_EINGERICHTET", message: "Street View ist nicht eingerichtet." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ungenaue Adresse: kein Abruf, genau false (Review Focus 1)", async () => {
    mocks.streetViewAdresse.mockResolvedValue("Umzug innerhalb Stuttgart");
    const res = await GET(getReq("seite=beladen"), p);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      status: "ungenau", bildUrl: null, panoLink: null, notiz: null, genau: false, adresse: "Umzug innerhalb Stuttgart",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ohne Adresse: keine_adresse", async () => {
    mocks.streetViewAdresse.mockResolvedValue(null);
    expect((await (await GET(getReq("seite=entladen"), p)).json()).data.status).toBe("keine_adresse");
  });

  it("Nur-Lesen-Schlüssel: kein Abruf, nichts gespeichert", async () => {
    mocks.getAuthContext.mockResolvedValue(NUR_LESEN);
    const res = await GET(getReq("seite=beladen"), p);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("nicht_geladen");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.zeilen.size).toBe(0);
  });

  it("kein_bild wird gemerkt: zweiter Aufruf ruft Google nicht", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ZERO_RESULTS" })));
    expect((await (await GET(getReq("seite=beladen"), p)).json()).data.status).toBe("kein_bild");
    fetchMock.mockClear();
    const zweite = (await (await GET(getReq("seite=beladen"), p)).json()).data;
    expect(zweite.status).toBe("kein_bild");
    expect(zweite.bildUrl).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fremder Workspace sieht die Zeile eines anderen nicht", async () => {
    mocks.zeilen.set(`ws_2|${KEY}`, {
      workspaceId: "ws_2", adresseSchluessel: KEY, adresse: ADRESSE, status: "ok", blobPfad: "ws/ws_2/x.jpg",
      panoId: "P2", geholtAm: new Date(), notiz: "fremd", notizVonName: "X", notizAm: new Date(),
    });
    mocks.getAuthContext.mockResolvedValue(NUR_LESEN);
    const data = (await (await GET(getReq("seite=beladen"), p)).json()).data;
    expect(data).toMatchObject({ status: "nicht_geladen", notiz: null, panoLink: null, bildUrl: null });
  });
});

describe("GET /deals/[recordId]/street-view/bild", () => {
  const bildReq = (k: string) => new NextRequest(`http://localhost/api/v1/deals/deal_1/street-view/bild?seite=beladen&k=${k}`);

  it("streamt das gespeicherte Bild privat mit Tages-Cache", async () => {
    mocks.zeilen.set(`ws_1|${KEY}`, { status: "ok", blobPfad: `ws/ws_1/street-view/${KEY}.jpg`, geholtAm: new Date() });
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(new Uint8Array([9, 9])).body,
      blob: { contentType: "image/jpeg" },
    });
    const res = await BILD(bildReq(KEY), p);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(mocks.get).toHaveBeenCalledWith(`ws/ws_1/street-view/${KEY}.jpg`, { access: "private" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unbekannter oder fremder Schlüssel → 404", async () => {
    mocks.zeilen.set(`ws_2|${KEY}`, { status: "ok", blobPfad: "ws/ws_2/x.jpg", geholtAm: new Date() });
    expect((await BILD(bildReq(KEY), p)).status).toBe(404);
    expect((await BILD(bildReq("abc"), p)).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await BILD(bildReq(KEY), p)).status).toBe(404);
  });
});

describe("PUT /deals/[recordId]/street-view/notiz", () => {
  const putReq = (body: unknown) =>
    new NextRequest("http://localhost/api/v1/deals/deal_1/street-view/notiz", { method: "PUT", body: JSON.stringify(body) });

  it("setzt die Notiz der Adresse mit Autor aus dem Kontext", async () => {
    mocks.notizSetzen.mockImplementation(async (ws: string, k: string, text: string) => {
      mocks.zeilen.set(`${ws}|${k}`, { status: "ok", geholtAm: new Date(), notiz: text, notizVonName: "Dario", notizAm: new Date("2026-11-06T10:00:00Z") });
      return true;
    });
    const res = await PUT(putReq({ seite: "entladen", text: "  Einfahrt eng, Halteverbot sinnvoll " }), p);
    expect(res.status).toBe(200);
    expect(mocks.notizSetzen).toHaveBeenCalledWith("ws_1", KEY, "Einfahrt eng, Halteverbot sinnvoll", "usr_1");
    expect((await res.json()).data.notiz).toEqual({
      text: "Einfahrt eng, Halteverbot sinnvoll", von: "Dario", am: "2026-11-06T10:00:00.000Z",
    });
  });

  it("leerer Text löscht die Notiz", async () => {
    mocks.notizSetzen.mockResolvedValue(true);
    mocks.zeilen.set(`ws_1|${KEY}`, { status: "ok", geholtAm: new Date(), notiz: null });
    const res = await PUT(putReq({ seite: "beladen", text: "" }), p);
    expect(mocks.notizSetzen).toHaveBeenCalledWith("ws_1", KEY, null, "usr_1");
    expect((await res.json()).data.notiz).toBeNull();
  });

  it("über 500 Zeichen, falsche seite oder ungenaue Adresse → 400", async () => {
    expect((await PUT(putReq({ seite: "beladen", text: "x".repeat(501) }), p)).status).toBe(400);
    expect((await PUT(putReq({ seite: "x", text: "a" }), p)).status).toBe(400);
    mocks.streetViewAdresse.mockResolvedValue("Stuttgart");
    expect((await PUT(putReq({ seite: "beladen", text: "a" }), p)).status).toBe(400);
    expect(mocks.notizSetzen).not.toHaveBeenCalled();
  });

  it("ohne gespeichertes Street View → 404", async () => {
    mocks.notizSetzen.mockResolvedValue(false);
    expect((await PUT(putReq({ seite: "beladen", text: "a" }), p)).status).toBe(404);
  });

  it("Nur-Lesen-Schlüssel → 403, fremder Deal → 404", async () => {
    mocks.getAuthContext.mockResolvedValue(NUR_LESEN);
    expect((await PUT(putReq({ seite: "beladen", text: "a" }), p)).status).toBe(403);
    mocks.getAuthContext.mockResolvedValue(CTX);
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await PUT(putReq({ seite: "beladen", text: "a" }), p)).status).toBe(404);
    expect(mocks.notizSetzen).not.toHaveBeenCalled();
  });
});
