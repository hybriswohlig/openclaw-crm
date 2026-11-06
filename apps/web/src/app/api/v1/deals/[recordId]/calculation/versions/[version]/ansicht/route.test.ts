import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ladeKalkulationsAnsicht: vi.fn(),
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
vi.mock("@/services/kalkulations-ansicht", () => ({ ladeKalkulationsAnsicht: mocks.ladeKalkulationsAnsicht }));

import { GET } from "./route";
import { VersionsFehler } from "@/services/kalkulation-versionen";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = () => new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2/ansicht", { method: "GET" });
const p = (version: string) => ({ params: Promise.resolve({ recordId: "deal_1", version }) });
const ANSICHT = { kopf: { name: "Familie Weber" }, version: { nummer: 2, sperrbar: true } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.ladeKalkulationsAnsicht.mockResolvedValue(ANSICHT);
});

describe("GET /calculation/versions/[version]/ansicht", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(req(), p("2"))).status).toBe(401);
    expect(mocks.ladeKalkulationsAnsicht).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(req(), p("2"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Deal nicht gefunden.");
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.ladeKalkulationsAnsicht).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5", "01"])("Version %s → 400", async (v) => {
    expect((await GET(req(), p(v))).status).toBe(400);
    expect(mocks.ladeKalkulationsAnsicht).not.toHaveBeenCalled();
  });

  it("liefert { ansicht } für Workspace, Deal und Version", async () => {
    const res = await GET(req(), p("2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ansicht: ANSICHT } });
    expect(mocks.ladeKalkulationsAnsicht).toHaveBeenCalledWith("ws_1", "deal_1", 2);
  });

  it("unbekannte Version → 404 NICHT_GEFUNDEN", async () => {
    mocks.ladeKalkulationsAnsicht.mockRejectedValue(new VersionsFehler("NICHT_GEFUNDEN", "Version v7 nicht gefunden."));
    const res = await GET(req(), p("7"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NICHT_GEFUNDEN", message: "Version v7 nicht gefunden." });
  });

  it("Nur-Lese-Schlüssel darf lesen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await GET(req(), p("2"))).status).toBe(200);
  });
});
