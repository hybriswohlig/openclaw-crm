import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  lesen: vi.fn(),
  entwurfHolenOderAnlegen: vi.fn(),
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
vi.mock("@/services/kalkulation-versionen-speicher", () => ({
  dbVersionsSpeicher: { liste: vi.fn(), lesen: mocks.lesen },
}));
vi.mock("@/services/kalkulation-versionen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kalkulation-versionen")>();
  return { ...actual, entwurfHolenOderAnlegen: mocks.entwurfHolenOderAnlegen };
});

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = () => new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2", { method: "GET" });
const p = (version: string) => ({ params: Promise.resolve({ recordId: "deal_1", version }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.lesen.mockResolvedValue({ id: "v2", version: 2, status: "entwurf", rechnerResult: { preis: { festpreis: 900 } } });
});

describe("GET /calculation/versions/[version]", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(req(), p("2"))).status).toBe(401);
  });

  it("Deal aus fremdem Workspace → 404", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(req(), p("2"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Deal nicht gefunden.");
    expect(mocks.lesen).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5", "01", "1e3", "99999999999"])("Version %s → 400", async (v) => {
    const res = await GET(req(), p(v));
    expect(res.status).toBe(400);
    expect(mocks.lesen).not.toHaveBeenCalled();
  });

  it("liefert die ganze Version (mit Schnappschuss)", async () => {
    const res = await GET(req(), p("2"));
    expect(res.status).toBe(200);
    expect(mocks.lesen).toHaveBeenCalledWith("ws_1", "deal_1", 2);
    expect((await res.json()).data.version.rechnerResult.preis.festpreis).toBe(900);
  });

  it("unbekannte Version → 404 NICHT_GEFUNDEN", async () => {
    mocks.lesen.mockResolvedValue(null);
    const res = await GET(req(), p("7"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NICHT_GEFUNDEN", message: "Version v7 nicht gefunden." });
  });

  it("Nur-Lese-Schlüssel: GET liest nur", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await GET(req(), p("2"))).status).toBe(200);
    expect(mocks.entwurfHolenOderAnlegen).not.toHaveBeenCalled();
  });
});
