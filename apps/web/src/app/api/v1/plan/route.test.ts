import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladePlan: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/plan", () => ({ ladePlan: mocks.ladePlan }));

import { LEERER_FILTER } from "@/lib/leads-board";
import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "api_key" as const };
const get = (query = "") => new NextRequest(`http://localhost/api/v1/plan${query}`);
const ANTWORT = {
  von: "2026-11-02",
  bis: "2026-11-08",
  heute: "2026-11-06",
  eintraege: [],
  imBlick: [],
  firmen: [],
  mitarbeiter: [],
  stufen: [],
  besichtigungFeld: null,
  stand: "2026-11-06T11:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladePlan.mockResolvedValue(ANTWORT);
});

describe("GET /plan", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get("?von=2026-11-02&bis=2026-11-08"))).status).toBe(401);
    expect(mocks.ladePlan).not.toHaveBeenCalled();
  });

  it("liefert { data: PlanAntwort } mit Fenster, Firma und Mitarbeiter", async () => {
    const res = await GET(get("?von=2026-11-02&bis=2026-11-08&firma=f_kottke&ma=e1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ANTWORT });
    expect(mocks.ladePlan).toHaveBeenCalledWith("ws_1", {
      von: "2026-11-02",
      bis: "2026-11-08",
      firmaId: "f_kottke",
      mitarbeiterId: "e1",
      leads: null,
    });
  });

  it("Leads-Kalender: Leads-Filter ohne Monat", async () => {
    await GET(get("?leads=1&von=2026-10-26&bis=2026-12-06&chip=warten&q=weber&monat=2026-11&nur=uns"));
    expect(mocks.ladePlan).toHaveBeenCalledWith("ws_1", {
      von: "2026-10-26",
      bis: "2026-12-06",
      firmaId: null,
      mitarbeiterId: null,
      leads: { ...LEERER_FILTER, chip: "warten", suche: "weber", nurWartet: true, monat: null },
    });
  });

  it("400 mit dem Fehlertext: fehlend, ungültig, vertauscht, mehr als 62 Tage", async () => {
    for (const q of ["", "?von=2026-11-02", "?von=2026-02-31&bis=2026-03-01", "?von=2026-11-08&bis=2026-11-02", "?von=2026-11-01&bis=2027-01-02"]) {
      const res = await GET(get(q));
      expect(res.status, q).toBe(400);
      const body = await res.json();
      expect(body.error.code, q).toBe("BAD_REQUEST");
      expect(typeof body.error.message, q).toBe("string");
    }
    expect((await (await GET(get("?von=2026-11-01&bis=2027-01-02"))).json()).error.message).toBe("Höchstens 62 Tage je Abfrage.");
    expect(mocks.ladePlan).not.toHaveBeenCalled();
  });
});
