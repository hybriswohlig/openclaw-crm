import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ getAuthContext: vi.fn(), ladeKunde: vi.fn(), speichereKunde: vi.fn() }));

vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  getAuthContext: m.getAuthContext,
}));
vi.mock("@/services/deal-kunde", async () => {
  const { KundeFehler } = await import("@/lib/deal-kunde");
  return { KundeFehler, ladeKunde: m.ladeKunde, speichereKunde: m.speichereKunde };
});

import { GET, PUT } from "./route";

const params = { params: Promise.resolve({ recordId: "deal_1" }) };
const put = (body: unknown) =>
  PUT(new NextRequest("https://crm.test/api/v1/deals/deal_1/kunde", { method: "PUT", body: JSON.stringify(body) }), params);

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: "ws_1", authMethod: "cookie" });
  m.ladeKunde.mockResolvedValue({ personId: null, name: "", nameAusPerson: false, telefon: null, email: null, auszug: null, einzug: null, datum: null });
  m.speichereKunde.mockImplementation(async () => ({ name: "Viktoria Muster" }));
});

describe("/api/v1/deals/:id/kunde", () => {
  it("ohne Anmeldung 401, fremder Deal 404", async () => {
    m.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(new NextRequest("https://crm.test/x"), params)).status).toBe(401);
    m.ladeKunde.mockResolvedValueOnce(null);
    expect((await GET(new NextRequest("https://crm.test/x"), params)).status).toBe(404);
  });

  it("PUT speichert die geprüfte Eingabe im eigenen Workspace", async () => {
    const res = await put({ auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" }, quelle: "vorpruefung" });
    expect(res.status).toBe(200);
    expect(m.speichereKunde).toHaveBeenCalledWith(
      "ws_1",
      "deal_1",
      { auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" }, quelle: "vorpruefung" },
      "usr_1"
    );
  });

  it("falsche Eingabe 400 mit Text, nichts gespeichert", async () => {
    const res = await put({ auszug: { strasse: "Tel. 0711 123456", plz: "70372", ort: "Stuttgart" } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Telefon");
    expect(m.speichereKunde).not.toHaveBeenCalled();
  });

  it("API-Schlüssel (auch voller Agenten-Schlüssel) dürfen weder lesen noch speichern", async () => {
    for (const apiKeyAccess of ["read", "full"]) {
      m.getAuthContext.mockResolvedValueOnce({ userId: null, workspaceId: "ws_1", authMethod: "api_key", apiKeyAccess });
      expect((await put({ name: "Viktoria Muster" })).status).toBe(403);
      m.getAuthContext.mockResolvedValueOnce({ userId: null, workspaceId: "ws_1", authMethod: "api_key", apiKeyAccess });
      expect((await GET(new NextRequest("https://crm.test/x"), params)).status).toBe(403);
    }
    expect(m.speichereKunde).not.toHaveBeenCalled();
    expect(m.ladeKunde).not.toHaveBeenCalled();
  });
});
