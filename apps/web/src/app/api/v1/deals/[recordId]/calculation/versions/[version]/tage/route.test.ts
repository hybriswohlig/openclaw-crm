import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  tageSetzen: vi.fn(),
  tagesRaster: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
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
vi.mock("@/services/kalkulation-versionen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kalkulation-versionen")>();
  return { ...actual, tageSetzen: mocks.tageSetzen, tagesRaster: mocks.tagesRaster };
});

import { POST, PUT } from "./route";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const URL_ = "http://localhost/api/v1/deals/deal_1/calculation/versions/2/tage";
const anfrage = (method: "POST" | "PUT", body: unknown) =>
  new NextRequest(URL_, { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } });
const p = (version = "2") => ({ params: Promise.resolve({ recordId: "deal_1", version }) });

/** Antwort des Dienstes mit Feldern, die nie hinausgehen dürfen. */
const RASTER_MIT_INTERNEM = {
  von: "2026-12-01",
  bis: "2026-12-02",
  zellen: [
    {
      datum: "2026-12-01",
      wochentag: "di",
      feiertag: false,
      preisCent: 110000,
      gruende: [{ text: "Eilauftrag", punkte: 5, selbstkosten: 1 }],
      auftraege: [{ dealId: "deal_9", name: "Müller", selbstkosten: 2 }],
      vergangen: false,
      selbstkosten: 66000,
      margeProzent: 40,
      rechnerFestpreis: 1100,
      kapazitaet: {
        text: "1 frei",
        ton: "gold",
        frei: ["Ali Bulut"],
        freiZahl: 1,
        kuerzel: "AB",
        belegt: [{ person: { id: "e9", name: "Max" } }],
        abwesend: [],
        tag: "2026-12-01",
        betragCent: 44000,
      },
    },
    {
      datum: "2026-12-02",
      wochentag: "mi",
      feiertag: false,
      preisCent: 120000,
      gruende: [],
      auftraege: [],
      vergangen: false,
      lohnCent: 8800,
    },
  ],
  wunschtermin: { datum: "2026-12-05", quelle: "deal", weitere: ["2026-12-06"], marge: 1 },
  hinweis: null,
  selbstkosten: 1,
  margeProzent: 2,
};

const TAGE = {
  tage: [
    { datum: "2026-12-04", slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: " Fr ", empfohlen: true },
    { datum: "2026-12-05", slots: [{ label: "Ganztags" }], note: null, empfohlen: false },
  ],
  uebersteuerungen: [{ datum: "2026-12-05", paketSlug: null, betrag: 1250, grund: " Stammkunde " }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.tagesRaster.mockResolvedValue(RASTER_MIT_INTERNEM);
  mocks.tageSetzen.mockResolvedValue({ id: "v3", version: 3, status: "entwurf" });
});

describe("POST /calculation/versions/[version]/tage (Raster)", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(anfrage("POST", { von: "2026-12-01", bis: "2026-12-31" }), p())).status).toBe(401);
  });

  it("Nur-Lese-Schlüssel → 403, nichts gerechnet", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await POST(anfrage("POST", { von: "2026-12-01", bis: "2026-12-31" }), p())).status).toBe(403);
    expect(mocks.tagesRaster).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gerechnet", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await POST(anfrage("POST", { von: "2026-12-01", bis: "2026-12-31" }), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.tagesRaster).not.toHaveBeenCalled();
  });

  it("Version nicht numerisch → 400", async () => {
    expect((await POST(anfrage("POST", { von: "2026-12-01", bis: "2026-12-31" }), p("zwei"))).status).toBe(400);
  });

  it.each([
    ["kein JSON", "kein json"],
    ["ohne bis", { von: "2026-12-01" }],
    ["kein Kalendertag", { von: "2026-02-30", bis: "2026-03-01" }],
    ["bis vor von", { von: "2026-12-10", bis: "2026-12-01" }],
    ["mehr als 42 Tage", { von: "2026-12-01", bis: "2027-01-12" }],
  ])("ungültig (%s) → 400, nichts gerechnet", async (_name, body) => {
    expect((await POST(anfrage("POST", body), p())).status).toBe(400);
    expect(mocks.tagesRaster).not.toHaveBeenCalled();
  });

  it("42 Tage gehen; Raster nur mit Vertragsfeldern, ohne Selbstkosten und Marge", async () => {
    const res = await POST(anfrage("POST", { von: "2026-12-01", bis: "2027-01-11" }), p());
    expect(res.status).toBe(200);
    expect(mocks.tagesRaster).toHaveBeenCalledWith("ws_1", "deal_1", 2, "2026-12-01", "2027-01-11");
    const text = await res.text();
    for (const intern of ["selbstkosten", "margeProzent", "rechnerFestpreis", "marge", "freiZahl", "betragCent", "kuerzel", "lohnCent", "belegt", "abwesend"]) {
      expect(text, intern).not.toContain(intern);
    }
    const data = JSON.parse(text).data;
    expect(Object.keys(data).sort()).toEqual(["bis", "hinweis", "von", "wunschtermin", "zellen"]);
    expect(data).toEqual({
      von: "2026-12-01",
      bis: "2026-12-02",
      zellen: [
        {
          datum: "2026-12-01",
          wochentag: "di",
          feiertag: false,
          preisCent: 110000,
          gruende: [{ text: "Eilauftrag", punkte: 5 }],
          auftraege: [{ dealId: "deal_9", name: "Müller" }],
          kapazitaet: { text: "1 frei", ton: "gold", frei: ["Ali Bulut"] },
          vergangen: false,
        },
        {
          datum: "2026-12-02",
          wochentag: "mi",
          feiertag: false,
          preisCent: 120000,
          gruende: [],
          auftraege: [],
          vergangen: false,
        },
      ],
      wunschtermin: { datum: "2026-12-05", quelle: "deal", weitere: ["2026-12-06"] },
      hinweis: null,
    });
    expect(Object.keys(data.zellen[0]).sort()).toEqual(
      ["auftraege", "datum", "feiertag", "gruende", "kapazitaet", "preisCent", "vergangen", "wochentag"].sort(),
    );
    expect(Object.keys(data.zellen[0].kapazitaet).sort()).toEqual(["frei", "text", "ton"]);
    expect(data.zellen[1]).not.toHaveProperty("kapazitaet");
  });

  it("speichert nichts: tageSetzen wird nie aufgerufen", async () => {
    await POST(anfrage("POST", { von: "2026-12-01", bis: "2026-12-31" }), p());
    expect(mocks.tageSetzen).not.toHaveBeenCalled();
  });

  it("Fehler des Dienstes mit seinem Code", async () => {
    mocks.tagesRaster.mockRejectedValue(new VersionsFehler("NICHT_GEFUNDEN", "Version v2 gibt es nicht."));
    const res = await POST(anfrage("POST", { von: "2026-12-01", bis: "2026-12-31" }), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NICHT_GEFUNDEN", message: "Version v2 gibt es nicht." });
  });
});

describe("PUT /calculation/versions/[version]/tage (Tage anbieten)", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await PUT(anfrage("PUT", TAGE), p())).status).toBe(401);
  });

  it("Nur-Lese-Schlüssel → 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await PUT(anfrage("PUT", TAGE), p())).status).toBe(403);
    expect(mocks.tageSetzen).not.toHaveBeenCalled();
  });

  it("Agent (voller API-Schlüssel) → 403: Tagespreise nur durch Menschen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    const res = await PUT(anfrage("PUT", TAGE), p());
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toBe("Tagespreise legt nur ein Mensch im Termin-Dialog fest.");
    expect(mocks.tageSetzen).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gespeichert", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await PUT(anfrage("PUT", TAGE), p())).status).toBe(404);
    expect(mocks.tageSetzen).not.toHaveBeenCalled();
  });

  it("speichert im Entwurf: { version }, Eingabe bereinigt, Autor aus dem Auth-Kontext", async () => {
    const res = await PUT(anfrage("PUT", { ...TAGE, autor: { quelle: "agent" } }), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ version: { id: "v3", version: 3, status: "entwurf" } });
    expect(mocks.tageSetzen).toHaveBeenCalledWith("ws_1", "deal_1", 2, { userId: "usr_1", quelle: "mensch" }, {
      tage: [
        { datum: "2026-12-04", slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: "Fr", empfohlen: true },
        { datum: "2026-12-05", slots: [{ label: "Ganztags", startTime: null, endTime: null }], note: null, empfohlen: false },
      ],
      uebersteuerungen: [{ datum: "2026-12-05", paketSlug: null, betrag: 1250, grund: "Stammkunde" }],
    });
  });

  it("ohne uebersteuerungen: leere Liste", async () => {
    await PUT(anfrage("PUT", { tage: TAGE.tage }), p());
    expect(mocks.tageSetzen.mock.calls[0][4].uebersteuerungen).toEqual([]);
  });

  const tag = (d: string, extra: Record<string, unknown> = {}) => ({ datum: d, slots: [{ label: "Vormittag" }], note: null, empfohlen: false, ...extra });
  it.each([
    ["kein JSON", "kein json"],
    ["tage fehlt", {}],
    ["mehr als 10 Tage", { tage: Array.from({ length: 11 }, (_, i) => tag(`2026-12-${String(i + 1).padStart(2, "0")}`)) }],
    ["kein Kalendertag", { tage: [tag("2026-11-31")] }],
    ["Tag doppelt", { tage: [tag("2026-12-04"), tag("2026-12-04")] }],
    ["ohne Zeitfenster", { tage: [{ ...tag("2026-12-04"), slots: [] }] }],
    ["Zeitfenster ohne Bezeichnung", { tage: [{ ...tag("2026-12-04"), slots: [{ label: " " }] }] }],
    ["Uhrzeit kaputt", { tage: [{ ...tag("2026-12-04"), slots: [{ label: "Früh", startTime: "8 Uhr" }] }] }],
    ["zwei Empfehlungen", { tage: [tag("2026-12-04", { empfohlen: true }), tag("2026-12-05", { empfohlen: true })] }],
    ["Anpassung ohne Grund", { tage: [tag("2026-12-04")], uebersteuerungen: [{ datum: "2026-12-04", paketSlug: null, betrag: 900, grund: " " }] }],
    ["Anpassung für nicht angebotenen Tag", { tage: [tag("2026-12-04")], uebersteuerungen: [{ datum: "2026-12-05", paketSlug: null, betrag: 900, grund: "x" }] }],
    ["Anpassung mit Betrag 0", { tage: [tag("2026-12-04")], uebersteuerungen: [{ datum: "2026-12-04", paketSlug: null, betrag: 0, grund: "x" }] }],
    ["Anpassung doppelt", { tage: [tag("2026-12-04")], uebersteuerungen: [{ datum: "2026-12-04", paketSlug: "komfort", betrag: 900, grund: "x" }, { datum: "2026-12-04", paketSlug: "komfort", betrag: 950, grund: "y" }] }],
  ])("ungültig (%s) → 400, nichts gespeichert", async (_name, body) => {
    expect((await PUT(anfrage("PUT", body), p())).status).toBe(400);
    expect(mocks.tageSetzen).not.toHaveBeenCalled();
  });

  it("Fehler des Dienstes mit seinem Code, Kundenannahme 409 KVA_ACCEPTED", async () => {
    mocks.tageSetzen.mockRejectedValueOnce(new VersionsFehler("RECHNER_FEHLER", "Rechner nicht erreichbar."));
    const a = await PUT(anfrage("PUT", TAGE), p());
    expect(a.status).toBe(409);
    expect((await a.json()).error.code).toBe("RECHNER_FEHLER");

    mocks.tageSetzen.mockRejectedValueOnce(new AngebotAngenommenError());
    const b = await PUT(anfrage("PUT", TAGE), p());
    expect(b.status).toBe(409);
    expect((await b.json()).error.code).toBe("KVA_ACCEPTED");
  });
});
