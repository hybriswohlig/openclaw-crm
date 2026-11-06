import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));

import { googleMapsLink, punkteSchluessel } from "@/lib/route-link";
import {
  ROUTES_API_URL,
  ROUTES_FIELD_MASK,
  routeFuer,
  type GespeicherteRoute,
  type RoutenSpeicher,
} from "./kalkulations-route";

const STATION = "Löwentorstraße 12, 70376 Stuttgart";
const BELADEN = "Heilbronner Str. 339, 70469 Stuttgart";
const ENTLADEN = "Hauptstr. 5, 73728 Esslingen";
const JETZT = new Date("2026-11-06T12:00:00Z");
const TAG = 24 * 60 * 60 * 1000;
const vor = (ms: number) => new Date(JETZT.getTime() - ms);

type V = Parameters<typeof routeFuer>[1];
function version(p: { status?: "entwurf" | "gesperrt"; von?: string; nach?: string | null; station?: string | null; vergleich?: number } = {}): V {
  const nach = p.nach === undefined ? ENTLADEN : p.nach;
  const station = p.station === undefined ? STATION : p.station;
  return {
    id: "ver_1",
    status: p.status ?? "entwurf",
    rechnerRequest: { von_adresse: p.von ?? BELADEN, ...(nach ? { nach_adresse: nach } : {}) },
    rechnerResult: {
      ...(station ? { mietstation: { name: "Sixt", anbieter: "Sixt", adresse: station, quelle: "x", anfahrtKm: 1, anfahrtMin: 1, rueckfahrtKm: 1, rueckfahrtMin: 1 } } : {}),
      stationsVergleich: Array.from({ length: p.vergleich ?? 3 }, (_, i) => ({ name: `S${i}`, festpreis: 1, selbstkosten: 1, gewaehlt: i === 0 })),
    },
  } as unknown as V;
}

function speicherMit(r: GespeicherteRoute | null = null) {
  const s = {
    zeile: r,
    lesen: vi.fn(async (ws: string, id: string) => (s.zeile && s.zeile.workspaceId === ws && s.zeile.calculationVersionId === id ? s.zeile : null)),
    schreiben: vi.fn(async (neu: GespeicherteRoute) => { s.zeile = neu; }),
  };
  return s as RoutenSpeicher & typeof s;
}

const LEG = (m: number, s: number, poly: string) => ({ distanceMeters: m, duration: `${s}s`, polyline: { encodedPolyline: poly } });
const fetchMock = vi.fn();
function googleAntwort(legs = [LEG(9_000, 960, "p1"), LEG(23_400, 1_860, "p2"), LEG(15_640, 1_500, "p3")]) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ routes: [{ legs }] })));
}
const gespeichert = (p: Partial<GespeicherteRoute> = {}): GespeicherteRoute => ({
  calculationVersionId: "ver_1",
  workspaceId: "ws_1",
  punkteSchluessel: punkteSchluessel({ station: STATION, beladen: BELADEN, entladen: ENTLADEN }),
  teilstrecken: [{ von: "Station", nach: "Beladen", km: 1, minuten: 2, polyline: "alt", haupt: false }],
  googleLink: googleMapsLink({ station: STATION, beladen: BELADEN, entladen: ENTLADEN }),
  berechnetAm: vor(TAG),
  ...p,
});
const opts = (speicher: RoutenSpeicher, darfAbrufen = true) => ({ darfAbrufen, speicher, jetzt: () => JETZT });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "maps_key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("routeFuer", () => {
  it("holt Station → Beladen → Entladen → Station über die Routes API und speichert", async () => {
    googleAntwort();
    const s = speicherMit();
    const r = await routeFuer("ws_1", version(), opts(s));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ROUTES_API_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-Goog-Api-Key": "maps_key", "X-Goog-FieldMask": ROUTES_FIELD_MASK });
    expect(JSON.parse(init.body)).toEqual({
      origin: { address: STATION },
      destination: { address: STATION },
      intermediates: [{ address: BELADEN }, { address: ENTLADEN }],
      travelMode: "DRIVE",
    });
    expect(r).toEqual({
      status: "ok",
      teilstrecken: [
        { von: "Station", nach: "Beladen", km: 9, minuten: 16, polyline: "p1", haupt: false },
        { von: "Beladen", nach: "Entladen", km: 23.4, minuten: 31, polyline: "p2", haupt: true },
        { von: "Entladen", nach: "Station", km: 15.6, minuten: 25, polyline: "p3", haupt: false },
      ],
      googleLink: googleMapsLink({ station: STATION, beladen: BELADEN, entladen: ENTLADEN }),
      stationen: 3,
      gesamtKm: 48,
      gesamtMinuten: 72,
    });
    expect(s.schreiben).toHaveBeenCalledWith(expect.objectContaining({
      calculationVersionId: "ver_1", workspaceId: "ws_1", berechnetAm: JETZT,
      punkteSchluessel: punkteSchluessel({ station: STATION, beladen: BELADEN, entladen: ENTLADEN }),
    }));
  });

  it("gespeicherte Route bei gleichem Schlüssel: kein Aufruf", async () => {
    const s = speicherMit(gespeichert());
    const r = await routeFuer("ws_1", version(), opts(s));
    expect(r.status).toBe("ok");
    expect(r.teilstrecken[0].polyline).toBe("alt");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("Entwurf mit geändertem Schlüssel: neu geholt und ersetzt", async () => {
    googleAntwort();
    const s = speicherMit(gespeichert());
    const r = await routeFuer("ws_1", version({ nach: "Neue Str. 1, 70173 Stuttgart" }), opts(s));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.teilstrecken[0].polyline).toBe("p1");
    expect(s.zeile?.punkteSchluessel).toBe(punkteSchluessel({ station: STATION, beladen: BELADEN, entladen: "Neue Str. 1, 70173 Stuttgart" }));
    expect(s.zeile?.googleLink).toContain("Neue%20Str.%201");
  });

  it("gesperrt mit geändertem Lead: alte Punkte bleiben; nach 30 Tagen mit denselben Punkten neu", async () => {
    const s = speicherMit(gespeichert());
    const geaendert = version({ status: "gesperrt", nach: "Neue Str. 1, 70173 Stuttgart" });
    const r = await routeFuer("ws_1", geaendert, opts(s));
    expect(r.status).toBe("ok");
    expect(r.googleLink).toBe(gespeichert().googleLink);
    expect(fetchMock).not.toHaveBeenCalled();

    s.zeile = gespeichert({ berechnetAm: vor(31 * TAG) });
    googleAntwort();
    const neu = await routeFuer("ws_1", geaendert, opts(s));
    expect(neu.status).toBe("ok");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).intermediates).toEqual([{ address: BELADEN }, { address: ENTLADEN }]);
    expect(s.zeile?.punkteSchluessel).toBe(gespeichert().punkteSchluessel);
    expect(s.zeile?.googleLink).toBe(gespeichert().googleLink);
    expect(s.zeile?.berechnetAm).toEqual(JETZT);
  });

  it("Entwurf mit gleichem Schlüssel nach 30 Tagen: neu", async () => {
    googleAntwort();
    const s = speicherMit(gespeichert({ berechnetAm: vor(31 * TAG) }));
    await routeFuer("ws_1", version(), opts(s));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ohne Station", { station: null }],
    ["ungenaue Beladeadresse", { von: "Umzug innerhalb Stuttgart" }],
    ["ungenaue Entladeadresse", { nach: "Esslingen" }],
  ])("%s → ungenau, kein Aufruf (Review Focus 1)", async (_n, p) => {
    const s = speicherMit();
    const r = await routeFuer("ws_1", version(p), opts(s));
    expect(r).toEqual({ status: "ungenau", teilstrecken: [], googleLink: null, stationen: 3, gesamtKm: null, gesamtMinuten: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("Fehler speichert nichts", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { status: "INTERNAL", message: "kaputt" } }), { status: 500 }));
    const s = speicherMit();
    const r = await routeFuer("ws_1", version(), opts(s));
    expect(r.status).toBe("fehler");
    expect(r.teilstrecken).toEqual([]);
    expect(r.googleLink).toContain("google.com/maps/dir");
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("Netzfehler und falsche Zahl Teilstrecken: fehler", async () => {
    const s = speicherMit();
    fetchMock.mockRejectedValue(new Error("offline"));
    expect((await routeFuer("ws_1", version(), opts(s))).status).toBe("fehler");
    googleAntwort([LEG(1, 1, "x")]);
    expect((await routeFuer("ws_1", version(), opts(s))).status).toBe("fehler");
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("403 oder PERMISSION_DENIED/REQUEST_DENIED → nicht_freigegeben", async () => {
    const s = speicherMit();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED" } }), { status: 403 }));
    expect((await routeFuer("ws_1", version(), opts(s))).status).toBe("nicht_freigegeben");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { status: "REQUEST_DENIED" } }), { status: 400 }));
    expect((await routeFuer("ws_1", version(), opts(s))).status).toBe("nicht_freigegeben");
    expect(s.schreiben).not.toHaveBeenCalled();
  });

  it("ohne Entladeadresse: Station → Beladen → Station, keine Hauptstrecke", async () => {
    googleAntwort([LEG(9_000, 960, "p1"), LEG(9_100, 1_000, "p2")]);
    const s = speicherMit();
    const r = await routeFuer("ws_1", version({ nach: null }), opts(s));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).intermediates).toEqual([{ address: BELADEN }]);
    expect(r.teilstrecken.map((t) => [t.von, t.nach, t.haupt])).toEqual([
      ["Station", "Beladen", false],
      ["Beladen", "Station", false],
    ]);
    expect(r.gesamtKm).toBe(18.1);
    expect(r.googleLink).toBe(googleMapsLink({ station: STATION, beladen: BELADEN, entladen: null }));
  });

  it("Nur-Lesen: kein Aufruf, nur gespeicherter Stand oder nicht_geladen", async () => {
    const leer = speicherMit();
    const r = await routeFuer("ws_1", version(), opts(leer, false));
    expect(r.status).toBe("nicht_geladen");
    expect(r.googleLink).toContain("google.com/maps/dir");
    const alt = speicherMit(gespeichert({ berechnetAm: vor(40 * TAG) }));
    expect((await routeFuer("ws_1", version(), opts(alt, false))).status).toBe("ok");
    const anders = speicherMit(gespeichert());
    expect((await routeFuer("ws_1", version({ nach: "Neue Str. 1, 70173 Stuttgart" }), opts(anders, false))).status).toBe("nicht_geladen");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(leer.schreiben).not.toHaveBeenCalled();
    expect(alt.schreiben).not.toHaveBeenCalled();
  });

  it("ohne Schlüssel: ohne_schluessel, kein Aufruf", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const s = speicherMit();
    expect((await routeFuer("ws_1", version(), opts(s))).status).toBe("ohne_schluessel");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Route eines anderen Workspace zählt nicht", async () => {
    const s = speicherMit(gespeichert({ workspaceId: "ws_2" }));
    expect((await routeFuer("ws_1", version(), opts(s, false))).status).toBe("nicht_geladen");
  });

  it("stationen: Anzahl im Stationsvergleich, sonst 1 mit Mietstation", async () => {
    const s = speicherMit(gespeichert());
    expect((await routeFuer("ws_1", version({ vergleich: 0 }), opts(s))).stationen).toBe(1);
    expect((await routeFuer("ws_1", version({ vergleich: 5 }), opts(s))).stationen).toBe(5);
  });
});
