import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TagesRaster } from "@/lib/angebot-wahl";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { dialogWaehlen, rasterLaden, sperrenUndKv, tageSpeichern, versionWaehlen } from "./termin-ablauf";

type Antwort = { status?: number; body: unknown };
type Aufruf = { url: string; method: string; body: unknown };

let aufrufe: Aufruf[] = [];

/** fetch-Attrappe: Antworten je „METHODE url“ der Reihe nach. */
function mockeFetch(antworten: Record<string, Antwort | Antwort[]>) {
  const zaehler = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const schluessel = `${method} ${url}`;
      aufrufe.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const eintrag = antworten[schluessel];
      if (!eintrag) throw new Error(`Unerwarteter Aufruf ${schluessel}`);
      const liste = Array.isArray(eintrag) ? eintrag : [eintrag];
      const i = zaehler.get(schluessel) ?? 0;
      zaehler.set(schluessel, i + 1);
      const a = liste[Math.min(i, liste.length - 1)];
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

const B = "/api/v1/deals/deal_1/calculation/versions";

function ansicht(felder: {
  nummer?: number;
  status?: "entwurf" | "gesperrt";
  tagespreise?: boolean;
  preisModus?: "fest" | "stunden";
  renderer?: "crm" | "vps";
  preisHash?: string | null;
  kvSumme?: number | null;
}): KalkulationsAnsicht {
  return {
    version: {
      nummer: felder.nummer ?? 3,
      status: felder.status ?? "entwurf",
      preisModus: felder.preisModus ?? "fest",
      renderer: felder.renderer ?? "crm",
      sperrbar: true,
      sperrGrund: null,
    },
    schalter: { angebotAusKalkulation: true, tagespreise: felder.tagespreise ?? true },
    kv: felder.kvSumme === null ? null : { posten: [], summeCent: felder.kvSumme ?? 248000, vorschau: true, obergrenze: false },
    preis: { gerundetCent: 248000 },
    preisHash: felder.preisHash === undefined ? "-@-=248000|-@2026-11-14=248000" : felder.preisHash,
  } as unknown as KalkulationsAnsicht;
}

beforeEach(() => {
  aufrufe = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Welcher Dialog", () => {
  it("Version wählen wie die Kalkulationsseite", () => {
    expect(versionWaehlen([])).toBeNull();
    expect(versionWaehlen([{ version: 1, status: "gesperrt" }, { version: 2, status: "entwurf" }, { version: 3, status: "gesperrt" }])).toBe(2);
    expect(versionWaehlen([{ version: 1, status: "gesperrt" }, { version: 4, status: "gesperrt" }])).toBe(4);
  });

  it("neu: Schalter an und Version da", async () => {
    mockeFetch({
      [`GET ${B}`]: { body: { data: { versionen: [{ version: 2, status: "gesperrt" }, { version: 3, status: "entwurf" }] } } },
      [`GET ${B}/3/ansicht`]: { body: { data: { ansicht: ansicht({}) } } },
    });
    const w = await dialogWaehlen("deal_1", null);
    expect(w.art).toBe("neu");
  });

  it("mit Version aus dem Event: keine Versionsliste", async () => {
    mockeFetch({ [`GET ${B}/2/ansicht`]: { body: { data: { ansicht: ansicht({ nummer: 2, status: "gesperrt" }) } } } });
    expect((await dialogWaehlen("deal_1", 2)).art).toBe("neu");
    expect(aufrufe.map((a) => a.url)).toEqual([`${B}/2/ansicht`]);
  });

  it("alt: ohne Version, ohne Schalter, Stundenmodus, bei Fehlern; legt nie eine Version an", async () => {
    mockeFetch({ [`GET ${B}`]: { body: { data: { versionen: [] } } } });
    expect(await dialogWaehlen("deal_1", null)).toEqual({ art: "alt", grund: "keine_version" });

    mockeFetch({ [`GET ${B}/3/ansicht`]: { body: { data: { ansicht: ansicht({ tagespreise: false }) } } } });
    expect(await dialogWaehlen("deal_1", 3)).toEqual({ art: "alt", grund: "schalter_aus" });

    mockeFetch({ [`GET ${B}/3/ansicht`]: { body: { data: { ansicht: ansicht({ preisModus: "stunden" }) } } } });
    expect(await dialogWaehlen("deal_1", 3)).toEqual({ art: "alt", grund: "stunden" });

    mockeFetch({ [`GET ${B}/3/ansicht`]: { status: 500, body: { error: { code: "X", message: "kaputt" } } } });
    expect(await dialogWaehlen("deal_1", 3)).toEqual({ art: "alt", grund: "fehler" });

    mockeFetch({ [`GET ${B}`]: { status: 404, body: { error: { code: "NICHT_GEFUNDEN", message: "weg" } } } });
    expect(await dialogWaehlen("deal_1", null)).toEqual({ art: "alt", grund: "fehler" });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await dialogWaehlen("deal_1", null)).toEqual({ art: "alt", grund: "fehler" });

    expect(aufrufe.every((a) => a.method === "GET")).toBe(true);
  });
});

describe("Raster und Speichern", () => {
  const raster: TagesRaster = {
    von: "2026-11-07",
    bis: "2026-11-30",
    zellen: [
      {
        datum: "2026-11-14",
        wochentag: "sa",
        feiertag: false,
        preisCent: 248000,
        gruende: [{ text: "Samstag", punkte: 5 }],
        auftraege: [{ dealId: "d9", name: "Weber" }],
        vergangen: false,
      },
    ],
    wunschtermin: { datum: "2026-11-14", quelle: "deal", weitere: [] },
    hinweis: null,
  };

  it("POST tage mit von und bis, nimmt beide Antwortformen", async () => {
    mockeFetch({ [`POST ${B}/3/tage`]: [{ body: { data: raster } }, { body: { data: { raster } } }] });
    const a = await rasterLaden("deal_1", 3, "2026-11-07", "2026-11-30");
    expect(a).toEqual({ ok: true, data: raster });
    expect(aufrufe[0].body).toEqual({ von: "2026-11-07", bis: "2026-11-30" });
    expect(await rasterLaden("deal_1", 3, "2026-11-07", "2026-11-30")).toEqual({ ok: true, data: raster });
  });

  it("Raster: Fehler des Dienstes kommt als Meldung durch", async () => {
    mockeFetch({ [`POST ${B}/3/tage`]: { status: 409, body: { error: { code: "UNGUELTIG", message: "Höchstens 42 Tage." } } } });
    const r = await rasterLaden("deal_1", 3, "2026-11-07", "2026-11-30");
    expect(r).toEqual({ ok: false, status: 409, code: "UNGUELTIG", message: "Höchstens 42 Tage." });
  });

  it("PUT tage: Nummer aus VersionsZeile oder { version }", async () => {
    const koerper = { tage: [{ datum: "2026-11-14", slots: [], note: null, empfohlen: true }], uebersteuerungen: [] };
    mockeFetch({
      [`PUT ${B}/2/tage`]: [{ body: { data: { id: "v4", version: 4, status: "entwurf" } } }, { body: { data: { version: { version: 5 } } } }, { body: { data: {} } }],
    });
    expect(await tageSpeichern("deal_1", 2, koerper)).toEqual({ ok: true, data: { version: 4 } });
    expect(aufrufe[0]).toMatchObject({ method: "PUT", body: koerper });
    expect(await tageSpeichern("deal_1", 2, koerper)).toEqual({ ok: true, data: { version: 5 } });
    expect((await tageSpeichern("deal_1", 2, koerper)).ok).toBe(false);
  });
});

describe("Sperren und KV wie auf der Kalkulationsseite", () => {
  it("Entwurf: lock nur mit Hash (wie die Kalkulationsseite), dann kv", async () => {
    mockeFetch({
      [`POST ${B}/3/lock`]: { body: { data: { version: { version: 3 } } } },
      [`POST ${B}/3/kv`]: { body: { data: { renderer: "crm", fileName: "KV-1001.pdf" } } },
    });
    const r = await sperrenUndKv("deal_1", ansicht({}), { intro: "Hallo" });
    expect(r).toEqual({ art: "fertig", fileName: "KV-1001.pdf" });
    expect(aufrufe.map((a) => a.url)).toEqual([`${B}/3/lock`, `${B}/3/kv`]);
    expect(aufrufe[0].body).toEqual({ bestaetigtSpanne: false, erwartetPreisHash: "-@-=248000|-@2026-11-14=248000" });
    expect(aufrufe[1].body).toEqual({ copy: { intro: "Hallo" } });
  });

  it("ohne Hash und ohne KV-Vorschau: Preis der Ansicht, kein Hash-Feld", async () => {
    mockeFetch({
      [`POST ${B}/3/lock`]: { body: { data: { version: { version: 3 } } } },
      [`POST ${B}/3/kv`]: { body: { data: { renderer: "crm" } } },
    });
    await sperrenUndKv("deal_1", ansicht({ preisHash: null, kvSumme: null }), {});
    expect(aufrufe[0].body).toEqual({ bestaetigtSpanne: false, erwartetPreisCent: 248000 });
  });

  it("gesperrte Version: nur kv; Kottke meldet den nächsten Dialog", async () => {
    mockeFetch({ [`POST ${B}/4/kv`]: { body: { data: { renderer: "vps", hinweis: "Der VPS erzeugt den KV." } } } });
    const r = await sperrenUndKv("deal_1", ansicht({ nummer: 4, status: "gesperrt", renderer: "vps" }), {});
    expect(r).toEqual({ art: "kottke", hinweis: "Der VPS erzeugt den KV." });
    expect(aufrufe.map((a) => a.url)).toEqual([`${B}/4/kv`]);
  });

  it("F2 (M5): MODUSWECHSEL → Rückfrage, nichts gesperrt; mit Bestätigung erneut mit modusWechselBestaetigt", async () => {
    mockeFetch({
      [`POST ${B}/3/lock`]: [
        { status: 409, body: { error: { code: "MODUSWECHSEL", message: "Das Angebot ist ein Stunden-KV." } } },
        { body: { data: { version: { version: 3 } } } },
      ],
      [`POST ${B}/3/kv`]: { body: { data: { renderer: "crm", fileName: "KV-1001.pdf" } } },
    });
    expect(await sperrenUndKv("deal_1", ansicht({}), {})).toEqual({ art: "moduswechsel", message: "Das Angebot ist ein Stunden-KV." });
    expect(aufrufe.map((a) => a.url)).toEqual([`${B}/3/lock`]);
    expect(await sperrenUndKv("deal_1", ansicht({}), {}, { modusWechselBestaetigt: true })).toEqual({ art: "fertig", fileName: "KV-1001.pdf" });
    expect(aufrufe[1].body).toMatchObject({ modusWechselBestaetigt: true });
    expect(aufrufe.map((a) => a.url)).toEqual([`${B}/3/lock`, `${B}/3/lock`, `${B}/3/kv`]);
  });

  it("PREIS_GEAENDERT und andere Fehler; nach einem Sperrfehler kein KV", async () => {
    mockeFetch({ [`POST ${B}/3/lock`]: { status: 409, body: { error: { code: "PREIS_GEAENDERT", message: "Der Preis hat sich geändert." } } } });
    expect(await sperrenUndKv("deal_1", ansicht({}), {})).toEqual({ art: "preis_geaendert", message: "Der Preis hat sich geändert." });
    expect(aufrufe).toHaveLength(1);

    mockeFetch({ [`POST ${B}/3/lock`]: { status: 409, body: { error: { code: "TAGESPREIS_NUR_MENSCH", message: "Nur Menschen." } } } });
    expect(await sperrenUndKv("deal_1", ansicht({}), {})).toEqual({ art: "fehler", schritt: "sperren", message: "Nur Menschen." });

    mockeFetch({
      [`POST ${B}/3/lock`]: { body: { data: { version: { version: 3 } } } },
      [`POST ${B}/3/kv`]: { status: 500, body: { error: { code: "X", message: "Renderer weg." } } },
    });
    expect(await sperrenUndKv("deal_1", ansicht({}), {})).toEqual({ art: "fehler", schritt: "kv", message: "Renderer weg." });
  });
});
