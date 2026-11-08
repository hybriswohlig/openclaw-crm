import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ladeRechnerStammdaten, rechnerStammdatenCacheLeeren } from "./stammdaten";

/** Plan 13, Task B: Rechner-Stammdaten für die Einstellungsseite. */

const KONFIG = { basis: "https://rechner.test", schluessel: "crm-key" };
const JETZT = new Date("2026-11-08T10:00:00Z");

const TARIF = {
  id: "t3",
  version: 3,
  marke: "kottke",
  aktiv: true,
  gueltigAb: "2026-10-01",
  kommentar: "Herbst",
  satzArbeit: "20.00",
  satzFahrt: "15.00",
  stundensatzIntern: "32.50",
  stundensatzVerkauf: "59",
  fahrzeugpauschaleVerkaufProTag: "120",
  kmSatzVerkauf: "1.2",
  gemeinkostenProzent: "12",
  versicherungPauschal: null,
  rundungEur: "10",
  halteverbotVerkauf: "150",
  entsorgungProCbmVerkauf: "45",
  material: [{ key: "karton", bezeichnung: "Umzugskarton", einheit: "stueck", satz: "2.5" }],
  margenregeln: [{ geheim: true }],
  faktoren: { wochenende: 1.2 },
};
const STATION = { id: "s1", name: "Depot Nord", anbieter: null, adresse: "Hauptstr. 1", aktiv: true, istDepot: true, wegezeitPersonalMin: 15, lat: 48.1, lng: 9.2 };
const FAHRZEUG = { id: "f1", name: "Sprinter", typ: "3,5 t", startortId: "s1", laderaumCbm: "14", mietpreisProTag: "89", aktiv: true, lat: 1 };

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function abrufMit(over: Partial<Record<"tarife" | "startorte" | "fahrzeuge", Response | Error>> = {}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const pfad = new URL(url).pathname.replace("/api/", "") as "tarife" | "startorte" | "fahrzeuge";
    const o = over[pfad];
    if (o instanceof Error) throw o;
    if (o) return o;
    if (pfad === "tarife") return antwort(200, { tarife: [TARIF] });
    if (pfad === "startorte") return antwort(200, { startorte: [STATION] });
    return antwort(200, { fahrzeuge: [FAHRZEUG] });
  });
}

beforeEach(() => rechnerStammdatenCacheLeeren());
afterEach(() => vi.useRealTimers());

describe("ladeRechnerStammdaten", () => {
  it("ruft drei Pfade mit dem CRM-Schlüssel, GET, no-store", async () => {
    const abruf = abrufMit();
    const r = await ladeRechnerStammdaten({ abruf, jetzt: JETZT, konfig: KONFIG });
    expect(r.ok).toBe(true);
    expect(abruf.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://rechner.test/api/fahrzeuge",
      "https://rechner.test/api/startorte",
      "https://rechner.test/api/tarife",
    ]);
    for (const [, init] of abruf.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(init?.cache).toBe("no-store");
      expect(init?.headers).toEqual({ authorization: "Bearer crm-key" });
    }
    if (!r.ok) return;
    expect(r.daten.tarif.kottke?.stundensatzIntern).toBe(32.5);
    expect(r.daten.fahrzeuge[0].stationName).toBe("Depot Nord");
    expect(r.daten.stand).toBe(JETZT.toISOString());
  });

  it("Rohfelder wie margenregeln, faktoren und Koordinaten fehlen", async () => {
    const r = await ladeRechnerStammdaten({ abruf: abrufMit(), jetzt: JETZT, konfig: KONFIG });
    const text = JSON.stringify(r);
    for (const feld of ["margenregeln", "faktoren", "geheim", '"lat"', '"lng"']) expect(text).not.toContain(feld);
  });

  it("nicht konfiguriert: Fehlertext, kein Abruf", async () => {
    const abruf = abrufMit();
    const r = await ladeRechnerStammdaten({ abruf, jetzt: JETZT, konfig: { basis: null, schluessel: "x" } });
    expect(r).toEqual({ ok: false, fehler: "Rechner nicht konfiguriert (RECHNER_URL, RECHNER_API_KEY)." });
    const r2 = await ladeRechnerStammdaten({ abruf, jetzt: JETZT, konfig: { basis: "https://r.test", schluessel: undefined } });
    expect(r2.ok).toBe(false);
    expect(abruf).not.toHaveBeenCalled();
  });

  it("401: Schlüssel abgelehnt", async () => {
    const r = await ladeRechnerStammdaten({ abruf: abrufMit({ startorte: antwort(401, {}) }), jetzt: JETZT, konfig: KONFIG });
    expect(r).toEqual({ ok: false, fehler: "Rechner lehnt den API-Schlüssel ab (RECHNER_API_KEY prüfen)." });
  });

  it("500 bei einer der drei Listen: nur Fehler, kein Teilergebnis", async () => {
    const r = await ladeRechnerStammdaten({ abruf: abrufMit({ fahrzeuge: antwort(500, {}) }), jetzt: JETZT, konfig: KONFIG });
    expect(r).toEqual({ ok: false, fehler: "Rechner nicht erreichbar." });
  });

  it("unvollständige Antwort: Fehler aus stammdatenAus", async () => {
    const r = await ladeRechnerStammdaten({ abruf: abrufMit({ tarife: antwort(200, { anders: [] }) }), jetzt: JETZT, konfig: KONFIG });
    expect(r.ok).toBe(false);
  });

  it("Abbruch nach 8 s", async () => {
    vi.useFakeTimers();
    const abruf = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("abgebrochen"), { name: "TimeoutError" })));
        })
    );
    const p = ladeRechnerStammdaten({ abruf, jetzt: JETZT, konfig: KONFIG });
    await vi.advanceTimersByTimeAsync(7_900);
    let fertig = false;
    void p.then(() => (fertig = true));
    await Promise.resolve();
    expect(fertig).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toEqual({ ok: false, fehler: "Rechner nicht erreichbar." });
  });

  it("Erfolg 60 s gecacht, danach neu", async () => {
    const abruf = abrufMit();
    await ladeRechnerStammdaten({ abruf, jetzt: JETZT, konfig: KONFIG });
    await ladeRechnerStammdaten({ abruf, jetzt: new Date(JETZT.getTime() + 59_000), konfig: KONFIG });
    expect(abruf).toHaveBeenCalledTimes(3);
    await ladeRechnerStammdaten({ abruf, jetzt: new Date(JETZT.getTime() + 61_000), konfig: KONFIG });
    expect(abruf).toHaveBeenCalledTimes(6);
  });

  it("Fehler werden nie gecacht", async () => {
    const kaputt = abrufMit({ tarife: antwort(500, {}) });
    expect((await ladeRechnerStammdaten({ abruf: kaputt, jetzt: JETZT, konfig: KONFIG })).ok).toBe(false);
    const heil = abrufMit();
    expect((await ladeRechnerStammdaten({ abruf: heil, jetzt: JETZT, konfig: KONFIG })).ok).toBe(true);
    expect(heil).toHaveBeenCalledTimes(3);
  });
});

describe("kein Rechner-Admin-Schlüssel im CRM", () => {
  it("der Name kommt in keiner Quelldatei unter apps/web/src vor (Tests ausgenommen)", () => {
    const nadel = ["RECHNER", "ADMIN"].join("_");
    const wurzel = resolve(__dirname, "../..");
    const treffer: string[] = [];
    const laufen = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const pfad = join(dir, name);
        if (statSync(pfad).isDirectory()) {
          if (name !== "node_modules") laufen(pfad);
        } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (readFileSync(pfad, "utf8").includes(nadel)) treffer.push(pfad);
        }
      }
    };
    laufen(wurzel);
    expect(treffer).toEqual([]);
  });
});
