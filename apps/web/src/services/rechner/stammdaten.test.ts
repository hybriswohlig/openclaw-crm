import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __leereStammdatenCache, RechnerStammdatenFehler, rechnerKlassen, rechnerStationen } from "./stammdaten";

const SCHLUESSEL = "crm-leseschluessel";
const ADMIN = "admin-geheim";

const STATIONEN = [
  { id: "s1", name: "Sixt Feuerbach", anbieter: "Sixt", aktiv: true, adresse: "Heilbronner Straße 1" },
  { id: "s2", name: "Depot", anbieter: null, aktiv: false },
  { name: "ohne id", aktiv: true },
];

const KLASSEN = [
  {
    id: "sprinter",
    name: "Sprinter L",
    typ: "transporter",
    anbieter: "Sixt",
    aktiv: true,
    mietpreisWochentage: { mo: "120.50", sa: "180" },
    inklusivKmProTag: "200",
    mehrkilometerPreis: "0.250",
    laderaumCbm: "12.00",
  },
  {
    id: "eigen",
    name: "Boxer",
    typ: "transporter",
    anbieter: null,
    aktiv: false,
    mietpreisWochentage: { mo: "kaputt" },
    inklusivKmProTag: "keine",
    mehrkilometerPreis: null,
  },
];

function jsonAntwort(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  __leereStammdatenCache();
  process.env.RECHNER_URL = "http://rechner.test/api/kalkulation";
  process.env.RECHNER_API_KEY = SCHLUESSEL;
  process.env.RECHNER_ADMIN_KEYS = `${ADMIN},zweiter-admin`;
});

afterEach(() => {
  __leereStammdatenCache();
  delete process.env.RECHNER_URL;
  delete process.env.RECHNER_API_KEY;
  delete process.env.RECHNER_ADMIN_KEYS;
  vi.restoreAllMocks();
});

describe("Rechner-Stammdaten", () => {
  it("holt Stationen und Klassen mit dem CRM-Schlüssel, Zahlentexte werden Zahlen", async () => {
    const abruf = vi.fn(async (url: string, init?: RequestInit) => {
      const kopf = JSON.stringify(init?.headers ?? {});
      expect(kopf).not.toContain(ADMIN);
      expect(kopf).not.toContain("zweiter-admin");
      expect((init?.headers as { authorization?: string }).authorization).toBe(`Bearer ${SCHLUESSEL}`);
      expect(init?.method).toBe("GET");
      if (url === "http://rechner.test/api/startorte") return jsonAntwort({ startorte: STATIONEN });
      if (url === "http://rechner.test/api/fahrzeuge") return jsonAntwort({ fahrzeuge: KLASSEN });
      return jsonAntwort({}, 404);
    });

    expect(await rechnerStationen({ abruf })).toEqual([
      { id: "s1", name: "Sixt Feuerbach", anbieter: "Sixt", aktiv: true },
      { id: "s2", name: "Depot", anbieter: null, aktiv: false },
    ]);
    expect(await rechnerKlassen({ abruf })).toEqual([
      {
        id: "sprinter",
        name: "Sprinter L",
        typ: "transporter",
        anbieter: "Sixt",
        aktiv: true,
        mietpreisWochentage: { mo: 120.5, sa: 180 },
        inklusivKmProTag: 200,
        mehrkilometerPreis: 0.25,
      },
      {
        id: "eigen",
        name: "Boxer",
        typ: "transporter",
        anbieter: null,
        aktiv: false,
        mietpreisWochentage: null,
        inklusivKmProTag: null,
        mehrkilometerPreis: null,
      },
    ]);
    expect(abruf).toHaveBeenCalledTimes(2);
  });

  it("innerhalb von fünf Minuten nur ein Abruf, danach wieder", async () => {
    let jetzt = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => jetzt);
    const abruf = vi.fn(async () => jsonAntwort({ startorte: STATIONEN }));
    await rechnerStationen({ abruf });
    jetzt += 5 * 60 * 1000 - 1;
    await rechnerStationen({ abruf });
    expect(abruf).toHaveBeenCalledTimes(1);
    jetzt += 1;
    await rechnerStationen({ abruf });
    expect(abruf).toHaveBeenCalledTimes(2);
  });

  it("fällt nicht auf RECHNER_ADMIN_KEYS zurück", async () => {
    delete process.env.RECHNER_API_KEY;
    const abruf = vi.fn(async () => jsonAntwort({ startorte: [] }));
    await expect(rechnerStationen({ abruf })).rejects.toBeInstanceOf(RechnerStammdatenFehler);
    await expect(rechnerStationen({ abruf })).rejects.toThrow(/nicht konfiguriert/);
    expect(abruf).not.toHaveBeenCalled();
  });

  it("Zeitlimit und HTTP 500 werden RechnerStammdatenFehler", async () => {
    const zeit = vi.fn(async () => {
      const e = new Error("timeout");
      e.name = "TimeoutError";
      throw e;
    });
    await expect(rechnerKlassen({ abruf: zeit })).rejects.toThrow(/Zeitlimit/);

    const http = vi.fn(async () => new Response("no", { status: 500 }));
    try {
      await rechnerKlassen({ abruf: http });
      expect.fail("sollte werfen");
    } catch (e) {
      expect(e).toBeInstanceOf(RechnerStammdatenFehler);
      expect((e as Error).message).toMatch(/HTTP 500/);
    }

    const weg = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(rechnerStationen({ abruf: weg })).rejects.toThrow(/nicht erreichbar/);
  });
});
