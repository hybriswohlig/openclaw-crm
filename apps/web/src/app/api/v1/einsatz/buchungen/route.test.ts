import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tageZwischen } from "@/lib/einsatz";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  operatingCompanyInWorkspace: vi.fn(),
  buchungenMitWarnungen: vi.fn(),
  buchungAnlegen: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/customer-portal-config", () => ({
  operatingCompanyInWorkspace: mocks.operatingCompanyInWorkspace,
}));
vi.mock("@/services/einsatz-buchungen", () => ({
  buchungenMitWarnungen: mocks.buchungenMitWarnungen,
  buchungAnlegen: mocks.buchungAnlegen,
}));

import { GET, POST } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const EINGABE = {
  firmaId: "oc_1",
  von: "2026-11-17",
  bis: "2026-11-23",
  stationId: "s1",
  stationName: "Sixt Feuerbach",
  stationAnbieter: "Sixt",
  klasseId: "k1",
  klasseName: "Sprinter L",
  mieteCent: 45000,
  inklusivKm: 800,
  mehrkmSatzCent: 35,
  geplanteAuftraege: 4,
  notiz: "Fenster",
};
const BUCHUNG = { id: "b1", ...EINGABE, status: "geplant" as const };

const get = (query: string) => new NextRequest(`http://localhost/api/v1/einsatz/buchungen${query}`);
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/einsatz/buchungen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.operatingCompanyInWorkspace.mockResolvedValue(true);
  mocks.buchungenMitWarnungen.mockResolvedValue([{ ...BUCHUNG, zuordnungen: [], text: "Leiste", warnungen: [] }]);
  mocks.buchungAnlegen.mockResolvedValue(BUCHUNG);
});

async function nurMensch(res: Response) {
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe("NUR_MENSCH");
}

describe("GET /api/v1/einsatz/buchungen", () => {
  it.each(["read", "full"] as const)("API-Schlüssel %s → 403 NUR_MENSCH", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: zugriff });
    await nurMensch(await GET(get("?von=2026-11-01&bis=2026-11-30")));
    expect(mocks.buchungenMitWarnungen).not.toHaveBeenCalled();
  });

  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get("?von=2026-11-01&bis=2026-11-30"))).status).toBe(401);
  });

  it("92 Tage gehen, 93 nicht", async () => {
    const tage = tageZwischen("2026-01-01", "2026-12-31", 93);
    const ok = await GET(get(`?von=2026-01-01&bis=${tage[91]}&firma=oc_1`));
    expect(ok.status).toBe(200);
    expect(mocks.buchungenMitWarnungen).toHaveBeenCalledWith("ws_1", "2026-01-01", tage[91], "oc_1");
    expect((await GET(get(`?von=2026-01-01&bis=${tage[92]}`))).status).toBe(400);
    expect((await GET(get("?von=2026-11-10&bis=2026-11-01"))).status).toBe(400);
    expect((await GET(get("?bis=2026-11-01"))).status).toBe(400);
    expect(mocks.buchungenMitWarnungen).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/einsatz/buchungen", () => {
  it.each(["read", "full"] as const)("API-Schlüssel %s → 403 NUR_MENSCH", async (zugriff) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: zugriff });
    await nurMensch(await POST(post(EINGABE)));
    expect(mocks.buchungAnlegen).not.toHaveBeenCalled();
  });

  it("fremde Firma → 404", async () => {
    mocks.operatingCompanyInWorkspace.mockResolvedValue(false);
    const res = await POST(post(EINGABE));
    expect(res.status).toBe(404);
    expect(mocks.operatingCompanyInWorkspace).toHaveBeenCalledWith("ws_1", "oc_1");
    expect(mocks.buchungAnlegen).not.toHaveBeenCalled();
  });

  it("ungültiger Zeitraum → 400 ZEITRAUM_UNGUELTIG", async () => {
    const res = await POST(post({ ...EINGABE, von: "2026-01-01", bis: "2026-02-01" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("ZEITRAUM_UNGUELTIG");
    expect(mocks.buchungAnlegen).not.toHaveBeenCalled();
  });

  it("legt an und antwortet 201", async () => {
    const res = await POST(post({ ...EINGABE, createdBy: "hacker" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: BUCHUNG });
    expect(mocks.buchungAnlegen).toHaveBeenCalledWith("ws_1", EINGABE, "usr_1");
  });

  it("kein JSON → 400", async () => {
    expect((await POST(post("kein json"))).status).toBe(400);
    expect(mocks.buchungAnlegen).not.toHaveBeenCalled();
  });
});
