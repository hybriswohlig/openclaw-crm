import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  liste: vi.fn(),
  setzen: vi.fn(),
  laden: vi.fn(),
  freigeben: vi.fn(),
  deal: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [],
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.auth };
});
vi.mock("@/services/bewertungen-liste", () => ({ ladeBewertungen: mocks.liste }));
vi.mock("@/services/bewertung-modus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/bewertung-modus")>();
  return { ...actual, bewertungModusSetzen: mocks.setzen, ladeBewertungModus: mocks.laden };
});
vi.mock("@/services/bewertung-token", () => ({ tokenFreigeben: mocks.freigeben }));
vi.mock("@/lib/kalkulation-versionen-antwort", () => ({ dealImWorkspace: mocks.deal }));

import { GET } from "./route";
import { PUT } from "./firmen/[ocId]/route";
import { PATCH } from "./vormerkungen/[id]/route";
import { POST as freigeben } from "@/app/api/v1/deals/[recordId]/review-request/freigeben/route";
import { BewertungModusFehler } from "@/services/bewertung-modus";

const COOKIE = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const SCHLUESSEL = { ...COOKIE, authMethod: "api_key" as const, workspaceRole: "member" as const };
const MITGLIED = { ...COOKIE, workspaceRole: "member" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(COOKIE);
  mocks.liste.mockResolvedValue({ firmen: [], zeilen: [], zaehler: {}, altsperren: 0 });
  mocks.setzen.mockResolvedValue(undefined);
  mocks.laden.mockResolvedValue({ modus: "entwurf", seit: new Date("2026-11-08T12:00:00.000Z"), hakenPortal: true });
  mocks.freigeben.mockResolvedValue({ freigegeben: 1 });
  mocks.deal.mockResolvedValue(true);
});

describe("Bewertungsrouten, Zugriff", () => {
  it("API-Schlüssel ist auf jeder neuen Route 403", async () => {
    mocks.auth.mockResolvedValue(SCHLUESSEL);
    const faelle = [
      GET(new NextRequest("http://localhost/api/v1/bewertungen")),
      PUT(new NextRequest("http://localhost/api/v1/bewertungen/firmen/oc", { method: "PUT", body: "{}" }), {
        params: Promise.resolve({ ocId: "oc" }),
      }),
      PATCH(
        new NextRequest("http://localhost/api/v1/bewertungen/vormerkungen/v", {
          method: "PATCH",
          body: JSON.stringify({ aktion: "verwerfen" }),
        }),
        { params: Promise.resolve({ id: "v" }) }
      ),
      freigeben(new NextRequest("http://localhost/api/v1/deals/d/review-request/freigeben", { method: "POST" }), {
        params: Promise.resolve({ recordId: "d" }),
      }),
    ];
    const codes = await Promise.all(faelle);
    expect(codes.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.liste).not.toHaveBeenCalled();
    expect(mocks.setzen).not.toHaveBeenCalled();
    expect(mocks.freigeben).not.toHaveBeenCalled();
  });

  it("ohne Anmeldung 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/v1/bewertungen"))).status).toBe(401);
  });

  it("Fix-Welle M9: darfRegeln nur für Admins", async () => {
    const admin = await (await GET(new NextRequest("http://localhost/api/v1/bewertungen"))).json();
    expect(admin.data.darfRegeln).toBe(true);
    mocks.auth.mockResolvedValue(MITGLIED);
    const mitglied = await (await GET(new NextRequest("http://localhost/api/v1/bewertungen"))).json();
    expect(mitglied.data.darfRegeln).toBe(false);
  });

  it("unbekannte Liste ist 400", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/bewertungen?liste=alles"));
    expect(res.status).toBe(400);
    expect(mocks.liste).not.toHaveBeenCalled();
  });

  it("PUT: Mitglied 403, EINGABE 400, fremde Firma 404, Erfolg mit seit als ISO", async () => {
    mocks.auth.mockResolvedValue(MITGLIED);
    expect(
      (
        await PUT(new NextRequest("http://localhost/api/v1/bewertungen/firmen/oc", { method: "PUT", body: "{}" }), {
          params: Promise.resolve({ ocId: "oc" }),
        })
      ).status
    ).toBe(403);

    mocks.auth.mockResolvedValue(COOKIE);
    mocks.setzen.mockRejectedValueOnce(new BewertungModusFehler("EINGABE", "Modus muss aus, entwurf oder senden sein."));
    expect(
      (
        await PUT(
          new NextRequest("http://localhost/api/v1/bewertungen/firmen/oc", {
            method: "PUT",
            body: JSON.stringify({ modus: "vielleicht" }),
          }),
          { params: Promise.resolve({ ocId: "oc" }) }
        )
      ).status
    ).toBe(400);

    mocks.setzen.mockRejectedValueOnce(new BewertungModusFehler("FIRMA", "Firma nicht gefunden."));
    expect(
      (
        await PUT(
          new NextRequest("http://localhost/api/v1/bewertungen/firmen/oc", {
            method: "PUT",
            body: JSON.stringify({ modus: "entwurf" }),
          }),
          { params: Promise.resolve({ ocId: "fremd" }) }
        )
      ).status
    ).toBe(404);

    mocks.setzen.mockResolvedValueOnce(undefined);
    const ok = await PUT(
      new NextRequest("http://localhost/api/v1/bewertungen/firmen/oc", {
        method: "PUT",
        body: JSON.stringify({ modus: "entwurf", hakenPortal: true }),
      }),
      { params: Promise.resolve({ ocId: "oc" }) }
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      data: { modus: "entwurf", seit: "2026-11-08T12:00:00.000Z", hakenPortal: true },
    });
    expect(mocks.setzen).toHaveBeenCalledWith("ws_1", "oc", { modus: "entwurf", hakenPortal: true }, "usr_1");
  });

  it("PATCH andere Aktion 400, unbekannte Zeile 404", async () => {
    const falsch = await PATCH(
      new NextRequest("http://localhost/api/v1/bewertungen/vormerkungen/v", {
        method: "PATCH",
        body: JSON.stringify({ aktion: "loeschen" }),
      }),
      { params: Promise.resolve({ id: "v" }) }
    );
    expect(falsch.status).toBe(400);

    const weg = await PATCH(
      new NextRequest("http://localhost/api/v1/bewertungen/vormerkungen/fremd", {
        method: "PATCH",
        body: JSON.stringify({ aktion: "verwerfen" }),
      }),
      { params: Promise.resolve({ id: "fremd" }) }
    );
    expect(weg.status).toBe(404);
  });

  it("Freigeben: fremder Deal 404, nichts frei 409", async () => {
    mocks.deal.mockResolvedValueOnce(false);
    expect(
      (
        await freigeben(new NextRequest("http://localhost/api/v1/deals/d/review-request/freigeben", { method: "POST" }), {
          params: Promise.resolve({ recordId: "d" }),
        })
      ).status
    ).toBe(404);

    mocks.deal.mockResolvedValueOnce(true);
    mocks.freigeben.mockResolvedValueOnce({ freigegeben: 0 });
    const res = await freigeben(
      new NextRequest("http://localhost/api/v1/deals/d/review-request/freigeben", { method: "POST" }),
      { params: Promise.resolve({ recordId: "d" }) }
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "NICHTS_FREIZUGEBEN", message: "Nichts freizugeben." } });
  });
});
