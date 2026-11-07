/**
 * Plan 5b, Integration: die Antwort der Tage-Route (Task T) geht unverändert in
 * `rasterLaden` und `tageSpeichern` des Termin-Dialogs (Task U2). Die Route läuft
 * echt (Dienst gemockt), `fetch` reicht ihre Response an den Client durch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  tageSetzen: vi.fn(),
  tagesRaster: vi.fn(),
}));

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
import { rasterLaden, tageSpeichern } from "@/components/neu/termin/termin-ablauf";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import type { TagesRaster } from "@/lib/angebot-wahl";

const RASTER: TagesRaster = {
  von: "2026-12-01",
  bis: "2026-12-31",
  zellen: [
    { datum: "2026-12-01", wochentag: "di", feiertag: false, preisCent: 110000, gruende: [], auftraege: [], vergangen: false },
    { datum: "2026-12-25", wochentag: "fr", feiertag: true, preisCent: 140000, gruende: [{ text: "Feiertag", punkte: 10 }], auftraege: [{ dealId: "d9", name: "Müller" }], vergangen: false },
  ],
  wunschtermin: { datum: "2026-12-05", quelle: "portal", weitere: [] },
  hinweis: null,
};

/** `fetch` des Browsers: ruft die Route mit derselben URL und Methode auf. */
function fetchUeberRoute() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const m = /\/deals\/([^/]+)\/calculation\/versions\/(\d+)\/tage$/.exec(url);
      if (!m) throw new Error(`unerwartete URL ${url}`);
      const req = new NextRequest(`http://localhost${url}`, { method: init?.method, body: init?.body as string, headers: { "content-type": "application/json" } });
      const p = { params: Promise.resolve({ recordId: decodeURIComponent(m[1]), version: m[2] }) };
      return init?.method === "PUT" ? PUT(req, p) : POST(req, p);
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin", authMethod: "cookie" });
  mocks.dealImWorkspace.mockResolvedValue(true);
  fetchUeberRoute();
});
afterEach(() => vi.unstubAllGlobals());

describe("Tage-Route (T) → Termin-Dialog (U2)", () => {
  it("POST: rasterLaden liest das Raster aus `{ data }`", async () => {
    mocks.tagesRaster.mockResolvedValue(RASTER);
    const r = await rasterLaden("deal_1", 3, "2026-12-01", "2026-12-31");
    expect(r).toEqual({ ok: true, data: RASTER });
    expect(mocks.tagesRaster).toHaveBeenCalledWith("ws_1", "deal_1", 3, "2026-12-01", "2026-12-31");
  });

  it("PUT: tageSpeichern liest die Nummer aus `{ data: { version: VersionsZeile } }` (auch ein neuer Entwurf)", async () => {
    mocks.tageSetzen.mockResolvedValue({ id: "ver_5", version: 5, status: "entwurf", dayPrices: [] });
    const r = await tageSpeichern("deal_1", 4, {
      tage: [{ datum: "2026-12-04", slots: [{ label: "ganztags", startTime: "08:00", endTime: "17:00" }], note: null, empfohlen: true }],
      uebersteuerungen: [],
    });
    expect(r).toEqual({ ok: true, data: { version: 5 } });
  });

  it("Fehler des Dienstes kommen mit Code und Text im Dialog an", async () => {
    mocks.tageSetzen.mockRejectedValue(new VersionsFehler("UNGUELTIG", "Tage in der Vergangenheit lassen sich nicht anbieten."));
    const r = await tageSpeichern("deal_1", 4, { tage: [], uebersteuerungen: [] });
    expect(r).toMatchObject({ ok: false, message: "Tage in der Vergangenheit lassen sich nicht anbieten." });
  });

  it("Prüffehler der Route (zwei Empfehlungen) als Text", async () => {
    const slots = [{ label: "ganztags", startTime: null, endTime: null }];
    const r = await tageSpeichern("deal_1", 4, {
      tage: [
        { datum: "2026-12-04", slots, note: null, empfohlen: true },
        { datum: "2026-12-05", slots, note: null, empfohlen: true },
      ],
      uebersteuerungen: [],
    });
    expect(r).toMatchObject({ ok: false, status: 400, message: "Höchstens ein Tag ist die Empfehlung." });
    expect(mocks.tageSetzen).not.toHaveBeenCalled();
  });
});
