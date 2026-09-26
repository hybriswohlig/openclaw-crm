import { afterEach, describe, expect, it } from "vitest";
import { rufeRechner } from "./client";

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
