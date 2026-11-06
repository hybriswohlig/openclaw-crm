import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  uebersteuern: vi.fn(),
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
  return { ...actual, uebersteuern: mocks.uebersteuern };
});

import { POST } from "./route";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { UebersteuerungFehler } from "@/lib/kalkulation-versionen";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2/overrides", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = (version = "2") => ({ params: Promise.resolve({ recordId: "deal_1", version }) });
const KORREKT = { art: "marge", key: "marge", wert: 45, grund: "Stammkunde" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.uebersteuern.mockResolvedValue({ version: { id: "v3", version: 3, status: "entwurf" }, neu: true });
});

describe("POST /calculation/versions/[version]/overrides", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(req(KORREKT), p())).status).toBe(401);
  });

  it("Deal aus fremdem Workspace → 404, nichts übersteuert", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await POST(req(KORREKT), p());
    expect(res.status).toBe(404);
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
  });

  it("Version nicht numerisch → 400", async () => {
    expect((await POST(req(KORREKT), p("v2"))).status).toBe(400);
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
  });

  it("ohne grund → 400 \"Grund fehlt\", vor jeder Nebenwirkung", async () => {
    const res = await POST(req({ art: "marge", key: "marge", wert: 45 }), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Grund fehlt");
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
  });

  it("kein JSON-Objekt → 400", async () => {
    expect((await POST(req("kaputt"), p())).status).toBe(400);
    expect((await POST(req([KORREKT]), p())).status).toBe(400);
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
  });

  it("ruft den Dienst mit Autor aus dem Kontext (Body-Autor zählt nicht); Antwort { version, neu }", async () => {
    const res = await POST(req({ ...KORREKT, fotoRef: "foto_1", autor: { userId: "x", quelle: "mensch" } }), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ version: { id: "v3", version: 3, status: "entwurf" }, neu: true });
    expect(mocks.uebersteuern).toHaveBeenCalledWith(
      "ws_1",
      "deal_1",
      2,
      { art: "marge", key: "marge", wert: 45, grund: "Stammkunde", fotoRef: "foto_1" },
      { userId: "usr_1", quelle: "mensch" }
    );
  });

  it("API-Schlüssel-Kontext → autor.quelle agent", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "full" });
    await POST(req(KORREKT), p());
    expect(mocks.uebersteuern.mock.calls[0][4]).toEqual({ userId: "usr_1", quelle: "agent" });
  });

  it("UebersteuerungFehler aus dem Dienst → 400", async () => {
    mocks.uebersteuern.mockRejectedValue(new UebersteuerungFehler("Unbekannte Kostenzeile: x"));
    const res = await POST(req({ art: "zeile", key: "x", wert: 10, grund: "g" }), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Unbekannte Kostenzeile: x");
  });

  it("VersionsFehler → Status und Code", async () => {
    mocks.uebersteuern.mockRejectedValue(new VersionsFehler("NICHT_GEFUNDEN", "Version v2 nicht gefunden."));
    const res = await POST(req(KORREKT), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NICHT_GEFUNDEN");
  });

  it("Kundenannahme → 409 KVA_ACCEPTED", async () => {
    mocks.uebersteuern.mockRejectedValue(new AngebotAngenommenError());
    const res = await POST(req(KORREKT), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("KVA_ACCEPTED");
  });
});
