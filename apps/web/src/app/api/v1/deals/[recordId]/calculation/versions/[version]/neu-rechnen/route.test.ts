import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  entwurfNeuRechnen: vi.fn(),
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
  return { ...actual, entwurfNeuRechnen: mocks.entwurfNeuRechnen };
});

import { POST } from "./route";
import { VersionsFehler } from "@/services/kalkulation-versionen";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = () => new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2/neu-rechnen", { method: "POST" });
const p = (version = "2") => ({ params: Promise.resolve({ recordId: "deal_1", version }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.entwurfNeuRechnen.mockResolvedValue({ version: { id: "v2", version: 2, status: "entwurf" }, gerechnet: true });
});

describe("POST /calculation/versions/[version]/neu-rechnen", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(req(), p())).status).toBe(401);
  });

  it("Nur-Lese-Schlüssel → 403, nichts gerechnet", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await POST(req(), p())).status).toBe(403);
    expect(mocks.entwurfNeuRechnen).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await POST(req(), p())).status).toBe(404);
    expect(mocks.entwurfNeuRechnen).not.toHaveBeenCalled();
  });

  it("Version nicht numerisch → 400", async () => {
    expect((await POST(req(), p("zwei"))).status).toBe(400);
    expect(mocks.entwurfNeuRechnen).not.toHaveBeenCalled();
  });

  it("rechnet: { version, gerechnet }, Autor aus dem Auth-Kontext", async () => {
    const res = await POST(req(), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ version: { id: "v2", version: 2, status: "entwurf" }, gerechnet: true });
    expect(mocks.entwurfNeuRechnen).toHaveBeenCalledWith("ws_1", "deal_1", 2, { userId: "usr_1", quelle: "mensch" });
  });

  it("gesperrte Version → 400 UNGUELTIG", async () => {
    mocks.entwurfNeuRechnen.mockRejectedValue(new VersionsFehler("UNGUELTIG", "Nur ein Entwurf kann neu gerechnet werden."));
    const res = await POST(req(), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "UNGUELTIG", message: "Nur ein Entwurf kann neu gerechnet werden." });
  });
});
