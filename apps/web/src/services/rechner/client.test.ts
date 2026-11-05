import { afterEach, describe, expect, it } from "vitest";
import { meldeKorrektur, rechnerBasisUrl, rufeRechner, type KorrekturMeldung } from "./client";

const SCHLUESSEL = "sehr-geheimer-schluessel";
const konfig = { url: "https://rechner.test/api/kalkulation", schluessel: SCHLUESSEL };

function antwort(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("rufeRechner", () => {
  afterEach(() => {
    delete process.env.RECHNER_URL;
    delete process.env.RECHNER_API_KEY;
  });

  it("ohne Konfiguration: Fehler statt Aufruf", async () => {
    const r = await rufeRechner({ zimmer: "3" }, { abruf: antwort(200, {}) });
    expect(r).toEqual({ ok: false, fehler: "Rechner nicht konfiguriert (RECHNER_URL, RECHNER_API_KEY)." });
  });

  it("liest die Konfiguration aus der Umgebung", async () => {
    process.env.RECHNER_URL = konfig.url;
    process.env.RECHNER_API_KEY = SCHLUESSEL;
    const r = await rufeRechner({ zimmer: "3" }, { abruf: antwort(200, { preis: { festpreis: 990 } }) });
    expect(r).toEqual({ ok: true, ergebnis: { preis: { festpreis: 990 } } });
  });

  it("schickt die Anfrage als JSON mit Bearer-Schlüssel", async () => {
    let gesehen: { url: string; init: RequestInit } | null = null;
    await rufeRechner({ zimmer: "3" }, {
      konfig,
      abruf: async (url, init) => {
        gesehen = { url: String(url), init: init! };
        return new Response("{}", { status: 200 });
      },
    });
    expect(gesehen!.url).toBe(konfig.url);
    expect(new Headers(gesehen!.init.headers).get("authorization")).toBe(`Bearer ${SCHLUESSEL}`);
    expect(JSON.parse(String(gesehen!.init.body))).toEqual({ zimmer: "3" });
  });

  it("falscher Schlüssel (401): verständlicher Fehler, der Schlüssel selbst taucht nicht auf", async () => {
    const r = await rufeRechner({}, { konfig, abruf: antwort(401, { fehler: "API-Schlüssel fehlt oder ist ungültig." }) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fehler).toMatch(/Schlüssel/);
      expect(r.fehler).not.toContain(SCHLUESSEL);
    }
  });

  it("Eingabefehler (400) gibt die Meldung des Rechners weiter", async () => {
    const r = await rufeRechner({}, { konfig, abruf: antwort(400, { fehler: "Freitextposition 1: menge fehlt" }) });
    expect(r).toEqual({ ok: false, fehler: "Rechner: Freitextposition 1: menge fehlt" });
  });

  it("Netzwerkfehler und Zeitlimit: nicht erreichbar", async () => {
    const netz = await rufeRechner({}, { konfig, abruf: async () => { throw new TypeError("fetch failed"); } });
    expect(netz).toEqual({ ok: false, fehler: "Rechner nicht erreichbar." });
    const zeit = await rufeRechner({}, { konfig, abruf: async () => { throw new DOMException("t", "TimeoutError"); } });
    expect(zeit).toEqual({ ok: false, fehler: "Rechner antwortet nicht (Zeitlimit)." });
  });

  it("Serverfehler (500) ohne JSON: allgemeiner Fehler mit Statuscode", async () => {
    const r = await rufeRechner({}, { konfig, abruf: async () => new Response("kaputt", { status: 500 }) });
    expect(r).toEqual({ ok: false, fehler: "Rechner-Fehler (HTTP 500)." });
  });
});

describe("rechnerBasisUrl", () => {
  afterEach(() => { delete process.env.RECHNER_URL; });

  it("Origin aus der vollen Kalkulations-URL", () => {
    expect(rechnerBasisUrl("https://umzugsrechner.vercel.app/api/kalkulation")).toBe("https://umzugsrechner.vercel.app");
  });
  it("liest RECHNER_URL, ohne Env oder bei kaputter URL null", () => {
    expect(rechnerBasisUrl()).toBeNull();
    process.env.RECHNER_URL = "http://localhost:3001/api/kalkulation";
    expect(rechnerBasisUrl()).toBe("http://localhost:3001");
    expect(rechnerBasisUrl("kein url")).toBeNull();
  });
});

describe("meldeKorrektur", () => {
  const meldung: KorrekturMeldung = {
    crm_deal_record_id: "deal1", crm_version: 2, tarif_id: "t1", tarif_version: 3, marke: "kottke",
    regel: "zeile", zeile_key: "personal.arbeit", eingaben: { zimmer: "3" }, rechnerwert: 400, inhaberwert: 450,
    grund: "Altbau ohne Aufzug", autor: "dario@test.de", foto_ref: null,
  };

  afterEach(() => {
    delete process.env.RECHNER_URL;
    delete process.env.RECHNER_API_KEY;
  });

  it("ohne Env: Fehler statt Aufruf", async () => {
    let gerufen = false;
    const r = await meldeKorrektur(meldung, { abruf: async () => { gerufen = true; return new Response("{}", { status: 201 }); } });
    expect(r).toEqual({ ok: false, fehler: "Rechner nicht konfiguriert (RECHNER_URL, RECHNER_API_KEY)." });
    expect(gerufen).toBe(false);
  });

  it("POST an {origin}/api/korrekturen mit Bearer und der Meldung als Body", async () => {
    process.env.RECHNER_URL = "https://umzugsrechner.vercel.app/api/kalkulation";
    process.env.RECHNER_API_KEY = SCHLUESSEL;
    let gesehen: { url: string; init: RequestInit } | null = null;
    const r = await meldeKorrektur(meldung, {
      abruf: async (url, init) => {
        gesehen = { url: String(url), init: init! };
        return new Response(JSON.stringify({ id: "k1" }), { status: 201 });
      },
    });
    expect(r).toEqual({ ok: true });
    expect(gesehen!.url).toBe("https://umzugsrechner.vercel.app/api/korrekturen");
    expect(gesehen!.init.method).toBe("POST");
    expect(new Headers(gesehen!.init.headers).get("authorization")).toBe(`Bearer ${SCHLUESSEL}`);
    expect(JSON.parse(String(gesehen!.init.body))).toEqual(meldung);
  });

  it("500: ok false, kein Wurf; Netzwerkfehler ebenso; 400 gibt die Meldung weiter", async () => {
    process.env.RECHNER_URL = "https://umzugsrechner.vercel.app/api/kalkulation";
    process.env.RECHNER_API_KEY = SCHLUESSEL;
    const r500 = await meldeKorrektur(meldung, { abruf: async () => new Response("kaputt", { status: 500 }) });
    expect(r500.ok).toBe(false);
    const netz = await meldeKorrektur(meldung, { abruf: async () => { throw new TypeError("fetch failed"); } });
    expect(netz).toEqual({ ok: false, fehler: "Rechner nicht erreichbar." });
    const r400 = await meldeKorrektur(meldung, { abruf: antwort(400, { fehler: "grund fehlt" }) });
    expect(r400).toEqual({ ok: false, fehler: "Rechner: grund fehlt" });
    const r401 = await meldeKorrektur(meldung, { abruf: antwort(401, { fehler: "x" }) });
    expect(r401.ok).toBe(false);
    if (!r401.ok) expect(r401.fehler).not.toContain(SCHLUESSEL);
  });
});
