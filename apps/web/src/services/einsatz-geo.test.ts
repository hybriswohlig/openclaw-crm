import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EinsatzPerson } from "@/lib/einsatz";
import { DriveTimeAPIError, matrixVonOrten } from "./drive-time";
import {
  __leereMinutenSpeicher,
  anfahrtenLaden,
  berlinZeitpunkt,
  GEOCODING_URL,
  ORTE_JE_AUFRUF,
  ortPunkte,
  type OrteSpeicher,
  type OrtZeile,
  type WegeSpeicher,
  type WegZeile,
} from "./einsatz-geo";

vi.mock("@/db", () => ({ db: {} }));

const person = (id: string, plz: string | null, ort: string | null, pkw = false): EinsatzPerson => ({
  id, name: id, kuerzel: id.slice(0, 2).toUpperCase(), aktiv: true, plz, wohnort: ort, kannSprinter: false, eigenerPkw: pkw,
  satzFahrtCent: 1500, satzArbeitCent: 2000,
});

function speicherMit(zeilen: WegZeile[]): WegeSpeicher & { geschrieben: unknown[] } {
  const geschrieben: unknown[] = [];
  return {
    geschrieben,
    lesen: async () => zeilen,
    schreiben: async (_ws, z) => {
      geschrieben.push(...z);
    },
  };
}

const JETZT = new Date("2026-11-10T10:00:00Z");
const TAG_ZUKUNFT = "2026-11-20";
const BELADEN = "Hauptstraße 1, 70176 Stuttgart";
const ENTLADEN = "Bahnhofstraße 2, 73728 Esslingen";

describe("anfahrtenLaden", () => {
  beforeEach(() => __leereMinutenSpeicher());

  it("gültiger Cache: kein Aufruf ohne Tag, Minuten geschätzt", async () => {
    const matrix = vi.fn();
    const speicher = speicherMit([
      { ortSchluessel: "70176 stuttgart", adresseSchluessel: "hauptstraße 1, 70176 stuttgart", km: 14, berechnetAm: new Date("2026-11-01") },
      { ortSchluessel: "70176 stuttgart", adresseSchluessel: "bahnhofstraße 2, 73728 esslingen", km: 20, berechnetAm: new Date("2026-11-01") },
    ]);
    const [a] = await anfahrtenLaden("w", { personen: [person("p1", "70176", "Stuttgart")], beladen: BELADEN, entladen: ENTLADEN, tag: null }, { jetzt: JETZT, speicher, matrix });
    expect(matrix).not.toHaveBeenCalled();
    expect(a).toEqual({ employeeId: "p1", anKm: 14, abKm: 20, anMin: 17, abMin: 24, anMinQuelle: "geschaetzt" });
  });

  it("gültiger Cache und Tag in der Zukunft: ein Aufruf nur für die Verkehrsminuten, 15 Minuten im Speicher", async () => {
    const matrix = vi.fn(async (orte: string[], _ziele: string[], _abfahrt: number | null) => orte.map(() => [{ meter: 14_200, sekunden: 22 * 60 }, { meter: 20_000, sekunden: 1500 }]));
    const speicher = speicherMit([
      { ortSchluessel: "70176 stuttgart", adresseSchluessel: "hauptstraße 1, 70176 stuttgart", km: 14, berechnetAm: new Date("2026-11-01") },
      { ortSchluessel: "70176 stuttgart", adresseSchluessel: "bahnhofstraße 2, 73728 esslingen", km: 20, berechnetAm: new Date("2026-11-01") },
    ]);
    const e = { personen: [person("p1", "70176", "Stuttgart")], beladen: BELADEN, entladen: ENTLADEN, tag: TAG_ZUKUNFT };
    const [a] = await anfahrtenLaden("w", e, { jetzt: JETZT, speicher, matrix, dealId: "d1" });
    expect(matrix).toHaveBeenCalledTimes(1);
    expect(matrix.mock.calls[0]![0]).toEqual(["70176 Stuttgart, Deutschland"]);
    expect(matrix.mock.calls[0]![2]).toBe(berlinZeitpunkt(TAG_ZUKUNFT));
    expect(a).toMatchObject({ anKm: 14.2, anMin: 22, anMinQuelle: "verkehr", abMin: 24 });
    await anfahrtenLaden("w", e, { jetzt: new Date(JETZT.getTime() + 10 * 60_000), speicher, matrix, dealId: "d1" });
    expect(matrix).toHaveBeenCalledTimes(1);
    await anfahrtenLaden("w", e, { jetzt: new Date(JETZT.getTime() + 10 * 60_000), speicher, matrix, dealId: "d1", frisch: true });
    expect(matrix).toHaveBeenCalledTimes(2);
  });

  it("Cache 31 Tage alt: neu holen und überschreiben, nie Minuten in der Tabelle", async () => {
    const matrix = vi.fn(async (orte: string[], _ziele: string[], _abfahrt: number | null) => orte.map(() => [{ meter: 15_000, sekunden: 900 }]));
    const speicher = speicherMit([
      { ortSchluessel: "70176 stuttgart", adresseSchluessel: "hauptstraße 1, 70176 stuttgart", km: 14, berechnetAm: new Date("2026-10-10T09:00:00Z") },
    ]);
    const [a] = await anfahrtenLaden("w", { personen: [person("p1", "70176", "Stuttgart")], beladen: BELADEN, entladen: null, tag: "2026-11-01" }, { jetzt: JETZT, speicher, matrix });
    expect(matrix).toHaveBeenCalledTimes(1);
    expect(matrix.mock.calls[0]![2]).toBeNull();
    expect(speicher.geschrieben).toEqual([{ ortSchluessel: "70176 stuttgart", adresseSchluessel: "hauptstraße 1, 70176 stuttgart", km: 15 }]);
    expect(a).toMatchObject({ anKm: 15, abKm: 15, anMinQuelle: "geschaetzt", anMin: 18 });
  });

  it("Google 403 oder ohne Schlüssel: Kilometer aus dem (alten) Cache oder null, kein Fehler", async () => {
    const matrix = vi.fn(async () => {
      throw new DriveTimeAPIError("Distance Matrix HTTP 403");
    });
    const speicher = speicherMit([
      { ortSchluessel: "70176 stuttgart", adresseSchluessel: "hauptstraße 1, 70176 stuttgart", km: 14, berechnetAm: new Date("2026-01-01") },
    ]);
    const r = await anfahrtenLaden(
      "w",
      { personen: [person("p1", "70176", "Stuttgart"), person("p2", "73728", "Esslingen"), person("p3", null, "Stuttgart")], beladen: BELADEN, entladen: null, tag: TAG_ZUKUNFT },
      { jetzt: JETZT, speicher, matrix },
    );
    expect(r.map((x) => [x.employeeId, x.anKm, x.anMinQuelle])).toEqual([
      ["p1", 14, "geschaetzt"],
      ["p2", null, null],
      ["p3", null, null],
    ]);
    expect(speicher.geschrieben).toEqual([]);
  });
});

describe("matrixVonOrten", () => {
  const alt = process.env.GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test";
  });
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = alt;
  });

  it("26 Orte: zwei Aufrufe, Reihenfolge bleibt, nicht routbar null", async () => {
    const urls: string[] = [];
    const abruf = async (u: string) => {
      urls.push(u);
      const origins = new URL(u).searchParams.get("origins")!.split("|");
      return new Response(
        JSON.stringify({
          status: "OK",
          origin_addresses: origins,
          destination_addresses: ["x"],
          rows: origins.map((o) => ({ elements: [o.startsWith("00000") ? { status: "ZERO_RESULTS" } : { status: "OK", distance: { value: 1000 }, duration: { value: 60 } }] })),
        }),
      );
    };
    const orte = Array.from({ length: 26 }, (_, i) => (i === 25 ? "00000 Nirgends, Deutschland" : `7${String(i).padStart(4, "0")} Ort, Deutschland`));
    const r = await matrixVonOrten(orte, ["Ziel"], null, abruf);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).searchParams.get("departure_time")).toBeNull();
    expect(r).toHaveLength(26);
    expect(r[0]![0]).toEqual({ meter: 1000, sekunden: 60 });
    expect(r[25]![0]).toBeNull();
  });

  it("HTTP 403 wirft DriveTimeAPIError", async () => {
    await expect(matrixVonOrten(["a"], ["b"], 1, async () => new Response("", { status: 403 }))).rejects.toBeInstanceOf(DriveTimeAPIError);
  });
});

describe("berlinZeitpunkt", () => {
  it("07:00 Berlin im Winter und im Sommer", () => {
    expect(new Date(berlinZeitpunkt("2026-11-20") * 1000).toISOString()).toBe("2026-11-20T06:00:00.000Z");
    expect(new Date(berlinZeitpunkt("2026-07-07") * 1000).toISOString()).toBe("2026-07-07T05:00:00.000Z");
  });
});

const NAME = "Anna Müller";

function orteSpeicher(anfang: OrtZeile[] = [], am: Date = JETZT): OrteSpeicher & { zeilen: OrtZeile[] } {
  const zeilen = anfang.map((z) => ({ ...z }));
  return {
    zeilen,
    async lesen(_ws, schluessel) {
      const set = new Set(schluessel);
      return zeilen.filter((z) => set.has(z.ortSchluessel));
    },
    async schreiben(_ws, neu) {
      for (const z of neu) {
        const row: OrtZeile = { ...z, berechnetAm: am };
        const i = zeilen.findIndex((x) => x.ortSchluessel === z.ortSchluessel);
        if (i >= 0) zeilen[i] = row;
        else zeilen.push(row);
      }
    },
  };
}

const geoOk = (lat: number, lng: number) =>
  new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat, lng } } }] }));

describe("ortPunkte", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("fetch nicht gefälscht");
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gültiger Cache: kein Aufruf", async () => {
    const abruf = vi.fn();
    const speicher = orteSpeicher([
      { ortSchluessel: "70176 stuttgart", lat: 48.5, lng: 9.25, berechnetAm: new Date(JETZT.getTime() - 10 * 24 * 60 * 60 * 1000) },
    ]);
    const r = await ortPunkte("w", [{ schluessel: "70176 stuttgart", text: "70176 Stuttgart", plz: "70176" }], {
      jetzt: JETZT, speicher, abruf, schluessel: "test-key",
    });
    expect(abruf).not.toHaveBeenCalled();
    expect(r.punkte.get("70176 stuttgart")).toEqual([9.25, 48.5]);
    expect(r.ohne).toEqual([]);
    expect(speicher.zeilen).toHaveLength(1);
    expect(speicher.zeilen[0]!.berechnetAm.getTime()).toBe(JETZT.getTime() - 10 * 24 * 60 * 60 * 1000);
  });

  it("31 Tage alt: neu geholt und geschrieben", async () => {
    const abruf = vi.fn(async () => geoOk(48.5, 9.25));
    const speicher = orteSpeicher([
      { ortSchluessel: "70176 stuttgart", lat: 1, lng: 2, berechnetAm: new Date(JETZT.getTime() - 31 * 24 * 60 * 60 * 1000) },
    ]);
    const r = await ortPunkte("w", [{ schluessel: "70176 stuttgart", text: "70176 Stuttgart", plz: "70176" }], {
      jetzt: JETZT, speicher, abruf, schluessel: "test-key",
    });
    expect(abruf).toHaveBeenCalledTimes(1);
    expect(r.punkte.get("70176 stuttgart")).toEqual([9.25, 48.5]);
    expect(speicher.zeilen).toEqual([{ ortSchluessel: "70176 stuttgart", lat: 48.5, lng: 9.25, berechnetAm: JETZT }]);
  });

  it("REQUEST_DENIED oder OVER_QUERY_LIMIT: leer, ohne enthält alle, nur ein Aufruf, kein Wurf", async () => {
    for (const status of ["REQUEST_DENIED", "OVER_QUERY_LIMIT"] as const) {
      const abruf = vi.fn(async () => new Response(JSON.stringify({ status, results: [] })));
      const speicher = orteSpeicher();
      const r = await ortPunkte(
        "w",
        [
          { schluessel: "a", text: "Aachen", plz: null },
          { schluessel: "b", text: "Bonn", plz: null },
        ],
        { jetzt: JETZT, speicher, abruf, schluessel: "test-key" },
      );
      expect(abruf).toHaveBeenCalledTimes(1);
      expect([...r.punkte.keys()]).toEqual([]);
      expect(r.ohne).toEqual(["a", "b"]);
      expect(speicher.zeilen).toEqual([]);
    }
  });

  it("HTTP-Fehler und Netzfehler brechen ab und behalten den abgelaufenen Punkt", async () => {
    const abgelaufen = { ortSchluessel: "a", lat: 1, lng: 2, berechnetAm: new Date("2020-01-01") };
    const http = vi.fn(async () => new Response("no", { status: 500 }));
    const r1 = await ortPunkte(
      "w",
      [
        { schluessel: "a", text: "Aachen", plz: null },
        { schluessel: "b", text: "Bonn", plz: null },
      ],
      { jetzt: JETZT, speicher: orteSpeicher([abgelaufen]), abruf: http, schluessel: "test-key" },
    );
    expect(http).toHaveBeenCalledTimes(1);
    expect(r1.punkte.get("a")).toEqual([2, 1]);
    expect(r1.ohne).toEqual(["b"]);

    const netz = vi.fn(async () => {
      throw new Error("offline");
    });
    const r2 = await ortPunkte("w", [{ schluessel: "a", text: "Aachen", plz: null }, { schluessel: "b", text: "Bonn", plz: null }], {
      jetzt: JETZT, speicher: orteSpeicher(), abruf: netz, schluessel: "test-key",
    });
    expect(netz).toHaveBeenCalledTimes(1);
    expect(r2.ohne).toEqual(["a", "b"]);
  });

  it("ohne Schlüssel: kein Aufruf, abgelaufener Cache-Punkt bleibt", async () => {
    const vorher = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = "soll-nicht-benutzt-werden";
    try {
      const abruf = vi.fn();
      const speicher = orteSpeicher([{ ortSchluessel: "70176 stuttgart", lat: 48.5, lng: 9.25, berechnetAm: new Date("2020-01-01") }]);
      const r = await ortPunkte("w", [{ schluessel: "70176 stuttgart", text: "70176 Stuttgart", plz: "70176" }], {
        jetzt: JETZT, speicher, abruf, schluessel: null,
      });
      expect(abruf).not.toHaveBeenCalled();
      expect(r.punkte.get("70176 stuttgart")).toEqual([9.25, 48.5]);
      expect(r.ohne).toEqual([]);
    } finally {
      if (vorher === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = vorher;
    }
  });

  it("26 neue Orte: 25 Aufrufe, einer in ohne; der zweite Aufruf holt den letzten aus dem Cache", async () => {
    expect(ORTE_JE_AUFRUF).toBe(25);
    const abruf = vi.fn(async (url: string) => {
      const n = Number(new URL(url).searchParams.get("address")?.match(/\d+/)?.[0] ?? 0);
      return geoOk(n, n + 0.5);
    });
    const speicher = orteSpeicher();
    const orte = Array.from({ length: 26 }, (_, i) => ({ schluessel: `o${i}`, text: `Ort ${i}`, plz: null as string | null }));
    const opt = { jetzt: JETZT, speicher, abruf, schluessel: "test-key" as string | null };
    const r1 = await ortPunkte("w", orte, opt);
    expect(abruf).toHaveBeenCalledTimes(25);
    expect(r1.ohne).toEqual(["o25"]);
    expect(r1.punkte.size).toBe(25);
    expect(speicher.zeilen).toHaveLength(25);
    const r2 = await ortPunkte("w", orte, opt);
    expect(abruf).toHaveBeenCalledTimes(26);
    expect(r2.ohne).toEqual([]);
    expect(r2.punkte.get("o25")).toEqual([25.5, 25]);
    expect(r2.punkte.get("o0")).toEqual([0.5, 0]);
  });

  it("URL enthält postal_code und country:DE, [lng, lat], keinen Personennamen", async () => {
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const abruf = vi.fn(async (_url: string) => geoOk(48.7, 9.1));
    const speicher = orteSpeicher();
    const r = await ortPunkte("w", [{ schluessel: "70176 stuttgart", text: "70176 Stuttgart", plz: "70176" }], {
      jetzt: JETZT, speicher, abruf, schluessel: "test-key",
    });
    const url = abruf.mock.calls[0]![0] as string;
    const params = new URL(url).searchParams;
    expect(url.startsWith(GEOCODING_URL)).toBe(true);
    expect(params.get("address")).toBe("70176 Stuttgart, Deutschland");
    expect(params.get("components")).toContain("postal_code:70176");
    expect(params.get("components")).toContain("country:DE");
    expect(params.get("language")).toBe("de");
    expect(params.get("key")).toBe("test-key");
    expect(url).not.toContain(NAME);
    expect(decodeURIComponent(url)).not.toContain(NAME);
    expect(r.punkte.get("70176 stuttgart")).toEqual([9.1, 48.7]);
    expect(speicher.zeilen[0]).toMatchObject({ lat: 48.7, lng: 9.1 });
    expect(fehler).not.toHaveBeenCalled();
    fehler.mockRestore();
  });

  it("doppelte Schlüssel nur ein Aufruf, der erste Text", async () => {
    const abruf = vi.fn(async (_url: string) => geoOk(1, 2));
    await ortPunkte(
      "w",
      [
        { schluessel: "a", text: "Erster", plz: "70176" },
        { schluessel: "a", text: `${NAME} Zweiter`, plz: "70111" },
      ],
      { jetzt: JETZT, speicher: orteSpeicher(), abruf, schluessel: "test-key" },
    );
    expect(abruf).toHaveBeenCalledTimes(1);
    expect(new URL(abruf.mock.calls[0]![0] as string).searchParams.get("address")).toBe("Erster, Deutschland");
    expect(abruf.mock.calls[0]![0] as string).not.toContain(NAME);
  });

  it("ZERO_RESULTS für einen Ort, der nächste wird trotzdem geholt", async () => {
    const abruf = vi.fn(async () => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] })));
    abruf.mockResolvedValueOnce(new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }))).mockResolvedValueOnce(geoOk(48.5, 9.25));
    const speicher = orteSpeicher();
    const r = await ortPunkte(
      "w",
      [
        { schluessel: "a", text: "Nirgends", plz: null },
        { schluessel: "b", text: "Bonn", plz: null },
      ],
      { jetzt: JETZT, speicher, abruf, schluessel: "test-key" },
    );
    expect(abruf).toHaveBeenCalledTimes(2);
    expect(r.ohne).toEqual(["a"]);
    expect(r.punkte.get("b")).toEqual([9.25, 48.5]);
    expect(r.punkte.has("a")).toBe(false);
    // Review M1: der Fehlversuch ist gemerkt (NaN), ohne Punkt.
    const a = speicher.zeilen.find((z) => z.ortSchluessel === "a")!;
    expect(Number.isNaN(a.lat) && Number.isNaN(a.lng)).toBe(true);
  });

  it("Fehlversuch jünger als 7 Tage: kein Aufruf; älter: erneut gefragt (Review M1)", async () => {
    const tag = 24 * 60 * 60 * 1000;
    const frisch = orteSpeicher([{ ortSchluessel: "a", lat: Number.NaN, lng: Number.NaN, berechnetAm: new Date(JETZT.getTime() - 6 * tag) }]);
    const abruf = vi.fn(async () => geoOk(48.5, 9.25));
    const r1 = await ortPunkte("w", [{ schluessel: "a", text: "Nirgends", plz: null }], { jetzt: JETZT, speicher: frisch, abruf, schluessel: "test-key" });
    expect(abruf).not.toHaveBeenCalled();
    expect(r1.ohne).toEqual(["a"]);
    expect(r1.punkte.size).toBe(0);
    const alt = orteSpeicher([{ ortSchluessel: "a", lat: Number.NaN, lng: Number.NaN, berechnetAm: new Date(JETZT.getTime() - 8 * tag) }]);
    const r2 = await ortPunkte("w", [{ schluessel: "a", text: "Nirgends", plz: null }], { jetzt: JETZT, speicher: alt, abruf, schluessel: "test-key" });
    expect(abruf).toHaveBeenCalledTimes(1);
    expect(r2.punkte.get("a")).toEqual([9.25, 48.5]);
  });

  it("nicht auffindbare Orte vorne blockieren die übrigen nicht (Review M1)", async () => {
    const tag = 24 * 60 * 60 * 1000;
    // 25 abgelaufene Fehlversuche vorn, ein nie gefragter Ort hinten: der neue kommt zuerst dran.
    const fehl = Array.from({ length: 25 }, (_, i) => ({ ortSchluessel: `f${i}`, lat: Number.NaN, lng: Number.NaN, berechnetAm: new Date(JETZT.getTime() - 8 * tag) }));
    const speicher = orteSpeicher(fehl);
    const urls: string[] = [];
    const abruf = vi.fn(async (u: string) => {
      urls.push(u);
      return u.includes("Bonn") ? geoOk(50.7, 7.1) : new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }));
    });
    const orte = [...fehl.map((z) => ({ schluessel: z.ortSchluessel, text: `Nirgends ${z.ortSchluessel}`, plz: null })), { schluessel: "neu", text: "Bonn", plz: null }];
    const r = await ortPunkte("w", orte, { jetzt: JETZT, speicher, abruf, schluessel: "test-key" });
    expect(urls[0]).toContain("Bonn");
    expect(r.punkte.get("neu")).toEqual([7.1, 50.7]);
    expect(abruf).toHaveBeenCalledTimes(25);
    // Beim nächsten Öffnen sind die 24 neu gemerkten Fehlversuche frisch, nur der letzte alte wird gefragt.
    const abruf2 = vi.fn(async () => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] })));
    await ortPunkte("w", orte, { jetzt: JETZT, speicher, abruf: abruf2, schluessel: "test-key" });
    expect(abruf2).toHaveBeenCalledTimes(1);
  });
});
