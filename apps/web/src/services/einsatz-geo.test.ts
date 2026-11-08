import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EinsatzPerson } from "@/lib/einsatz";
import { DriveTimeAPIError, matrixVonOrten } from "./drive-time";
import { __leereMinutenSpeicher, anfahrtenLaden, berlinZeitpunkt, type WegeSpeicher, type WegZeile } from "./einsatz-geo";

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
    const matrix = vi.fn(async (orte: string[]) => orte.map(() => [{ meter: 14_200, sekunden: 22 * 60 }, { meter: 20_000, sekunden: 1500 }]));
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
    const matrix = vi.fn(async (orte: string[]) => orte.map(() => [{ meter: 15_000, sekunden: 900 }]));
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
