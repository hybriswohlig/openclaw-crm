import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));

import { adresseGenau } from "@/lib/adresse-genau";
import {
  streetViewBildPfad,
  streetViewFuer,
  type StreetViewGespeichert,
  type StreetViewSpeicher,
} from "./street-view-cache";

const ADRESSE = "Heilbronner Str. 339, 70469 Stuttgart";
const KEY = adresseGenau(ADRESSE).schluessel!;
const JETZT = new Date("2026-11-06T12:00:00Z");
const TAG = 24 * 60 * 60 * 1000;
const vor = (ms: number) => new Date(JETZT.getTime() - ms);

function speicherMit(zeilen: StreetViewGespeichert[] = []) {
  const daten = new Map(zeilen.map((z) => [`${z.workspaceId}|${z.adresseSchluessel}`, z]));
  const s: StreetViewSpeicher & { daten: typeof daten; schreiben: ReturnType<typeof vi.fn> } = {
    daten,
    lesen: async (ws, k) => daten.get(`${ws}|${k}`) ?? null,
    schreiben: vi.fn(async (z) => {
      const alt = daten.get(`${z.workspaceId}|${z.adresseSchluessel}`);
      daten.set(`${z.workspaceId}|${z.adresseSchluessel}`, {
        ...z,
        notiz: alt?.notiz ?? null,
        notizVonName: alt?.notizVonName ?? null,
        notizAm: alt?.notizAm ?? null,
      });
    }),
    notizSetzen: async () => true,
  };
  return s;
}

function zeile(p: Partial<StreetViewGespeichert> = {}): StreetViewGespeichert {
  return {
    workspaceId: "ws_1",
    adresseSchluessel: KEY,
    adresse: ADRESSE,
    status: "ok",
    blobPfad: `ws/ws_1/street-view/${KEY}.jpg`,
    panoId: "PANO_ALT",
    geholtAm: vor(TAG),
    notiz: null,
    notizVonName: null,
    notizAm: null,
    ...p,
  };
}

const fetchMock = vi.fn();

function googleOk(panoId = "PANO_NEU") {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/streetview/metadata")) return new Response(JSON.stringify({ status: "OK", pano_id: panoId }));
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  mocks.put.mockReset();
  mocks.put.mockResolvedValue({ pathname: "x" });
  vi.stubEnv("GOOGLE_STREETVIEW_API_KEY", "sv_key");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const opts = (speicher: StreetViewSpeicher, darfAbrufen = true) => ({ darfAbrufen, speicher, jetzt: () => JETZT });

describe("streetViewFuer", () => {
  it("ohne Eintrag: holt Metadaten und Bild 640×400, legt es privat ab, speichert pano_id", async () => {
    googleOk();
    const s = speicherMit();
    const r = await streetViewFuer("ws_1", ADRESSE, opts(s));
    expect(r).toEqual({
      status: "ok",
      schluessel: KEY,
      panoLink: "https://www.google.com/maps/@?api=1&map_action=pano&pano=PANO_NEU",
      notiz: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bildUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(bildUrl.searchParams.get("size")).toBe("640x400");
    expect(bildUrl.searchParams.get("key")).toBe("sv_key");
    expect(mocks.put).toHaveBeenCalledWith(
      `ws/ws_1/street-view/${KEY}.jpg`,
      expect.any(Buffer),
      expect.objectContaining({ access: "private", allowOverwrite: true })
    );
    expect(s.schreiben).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok", panoId: "PANO_NEU", blobPfad: `ws/ws_1/street-view/${KEY}.jpg`, geholtAm: JETZT })
    );
  });

  it("nutzt GOOGLE_MAPS_API_KEY, wenn kein eigener Schlüssel da ist", async () => {
    vi.stubEnv("GOOGLE_STREETVIEW_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "maps_key");
    googleOk();
    await streetViewFuer("ws_1", ADRESSE, opts(speicherMit()));
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("key")).toBe("maps_key");
  });

  it("Treffer jünger als 30 Tage: kein Aufruf", async () => {
    const s = speicherMit([zeile({ geholtAm: vor(29 * TAG) })]);
    const r = await streetViewFuer("ws_1", ADRESSE, opts(s));
    expect(r.status).toBe("ok");
    expect(r.panoLink).toContain("pano=PANO_ALT");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("Treffer älter als 30 Tage: neuer Aufruf, Notiz bleibt", async () => {
    googleOk();
    const s = speicherMit([zeile({ geholtAm: vor(31 * TAG), notiz: "Einfahrt eng", notizVonName: "Dario", notizAm: vor(40 * TAG) })]);
    const r = await streetViewFuer("ws_1", ADRESSE, opts(s));
    expect(fetchMock).toHaveBeenCalled();
    expect(r.status).toBe("ok");
    expect(r.notiz).toEqual({ text: "Einfahrt eng", von: "Dario", am: vor(40 * TAG).toISOString() });
    expect(s.daten.get(`ws_1|${KEY}`)?.notiz).toBe("Einfahrt eng");
  });

  it("kein_bild vor 10 Tagen: kein Aufruf; vor 31 Tagen: neu", async () => {
    const s = speicherMit([zeile({ status: "kein_bild", blobPfad: null, panoId: null, geholtAm: vor(10 * TAG) })]);
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("kein_bild");
    expect(fetchMock).not.toHaveBeenCalled();

    s.daten.set(`ws_1|${KEY}`, zeile({ status: "kein_bild", blobPfad: null, panoId: null, geholtAm: vor(31 * TAG) }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ZERO_RESULTS" })));
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("kein_bild");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.schreiben).toHaveBeenCalledWith(expect.objectContaining({ status: "kein_bild", geholtAm: JETZT }));
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("fehler vor 30 Minuten: kein Aufruf; vor 2 Stunden: neu", async () => {
    const s = speicherMit([zeile({ status: "fehler", blobPfad: null, geholtAm: vor(30 * 60 * 1000) })]);
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("fehler");
    expect(fetchMock).not.toHaveBeenCalled();

    s.daten.set(`ws_1|${KEY}`, zeile({ status: "fehler", blobPfad: null, geholtAm: vor(2 * 60 * 60 * 1000) }));
    googleOk();
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("ok");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("Google antwortet mit Fehler: speichert fehler", async () => {
    fetchMock.mockResolvedValue(new Response("x", { status: 500 }));
    const s = speicherMit();
    const r = await streetViewFuer("ws_1", ADRESSE, opts(s));
    expect(r.status).toBe("fehler");
    expect(s.schreiben).toHaveBeenCalledWith(expect.objectContaining({ status: "fehler", blobPfad: null }));
  });

  it("Blob scheitert: fehler, kein ok gespeichert", async () => {
    googleOk();
    mocks.put.mockRejectedValue(new Error("blob down"));
    const s = speicherMit();
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("fehler");
    expect(s.schreiben).toHaveBeenCalledWith(expect.objectContaining({ status: "fehler" }));
  });

  it("ohne Schlüssel: ohne_schluessel, kein Aufruf, nichts gespeichert", async () => {
    vi.stubEnv("GOOGLE_STREETVIEW_API_KEY", "");
    const s = speicherMit();
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("ohne_schluessel");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("ohne Schlüssel, aber gültiger gespeicherter Stand: zeigt ihn", async () => {
    vi.stubEnv("GOOGLE_STREETVIEW_API_KEY", "");
    const s = speicherMit([zeile()]);
    expect((await streetViewFuer("ws_1", ADRESSE, opts(s))).status).toBe("ok");
  });

  it("ungenaue Adresse: kein Aufruf (Review Focus 1)", async () => {
    const s = speicherMit();
    const r = await streetViewFuer("ws_1", "Umzug innerhalb Stuttgart", opts(s));
    expect(r.status).toBe("nicht_geladen");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("Nur-Lesen: kein Aufruf, nur gespeicherter Stand oder nicht_geladen", async () => {
    const leer = speicherMit();
    expect((await streetViewFuer("ws_1", ADRESSE, opts(leer, false))).status).toBe("nicht_geladen");
    const alt = speicherMit([zeile({ geholtAm: vor(40 * TAG) })]);
    expect((await streetViewFuer("ws_1", ADRESSE, opts(alt, false))).status).toBe("nicht_geladen");
    const frisch = speicherMit([zeile()]);
    expect((await streetViewFuer("ws_1", ADRESSE, opts(frisch, false))).status).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(leer.schreiben).not.toHaveBeenCalled();
    expect(alt.schreiben).not.toHaveBeenCalled();
  });

  it("fremder Workspace sieht nichts: Zeile von ws_2 zählt nicht für ws_1", async () => {
    const s = speicherMit([zeile({ workspaceId: "ws_2", notiz: "geheim", notizVonName: "X", notizAm: JETZT })]);
    const r = await streetViewFuer("ws_1", ADRESSE, opts(s, false));
    expect(r).toEqual({ status: "nicht_geladen", schluessel: KEY, panoLink: null, notiz: null });
    expect(await streetViewBildPfad("ws_1", KEY, { speicher: s, jetzt: () => JETZT })).toBeNull();
    expect(await streetViewBildPfad("ws_2", KEY, { speicher: s, jetzt: () => JETZT })).toBe(`ws/ws_1/street-view/${KEY}.jpg`);
  });
});

describe("streetViewBildPfad", () => {
  it("nur gültige ok-Bilder, nur Hex-Schlüssel", async () => {
    const s = speicherMit([zeile()]);
    const j = { speicher: s, jetzt: () => JETZT };
    expect(await streetViewBildPfad("ws_1", KEY, j)).toBe(`ws/ws_1/street-view/${KEY}.jpg`);
    expect(await streetViewBildPfad("ws_1", "../x", j)).toBeNull();
    s.daten.set(`ws_1|${KEY}`, zeile({ geholtAm: vor(31 * TAG) }));
    expect(await streetViewBildPfad("ws_1", KEY, j)).toBeNull();
    s.daten.set(`ws_1|${KEY}`, zeile({ status: "kein_bild", blobPfad: null }));
    expect(await streetViewBildPfad("ws_1", KEY, j)).toBeNull();
  });
});
