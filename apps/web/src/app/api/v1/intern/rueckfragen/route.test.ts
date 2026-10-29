import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Wie app/api/v1/contract.test.ts: nur die Datenbank-Schicht des Dienstes ist
// gemockt, getAuthContext liefert den Kontext, Statuscodes und Hüllen sind echt.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  erstelleRueckfragen: vi.fn(),
  listeRueckfragen: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/intern/rueckfragen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/intern/rueckfragen")>();
  return { ...actual, erstelleRueckfragen: mocks.erstelleRueckfragen, listeRueckfragen: mocks.listeRueckfragen };
});

import { GET, POST } from "./route";
import { RueckfrageFehler } from "@/services/intern/rueckfragen";

const admin = { userId: "u1", workspaceId: "ws1", workspaceRole: "admin", permissions: {}, authMethod: "api_key", apiKeyAccess: "full" };
const post = (body: unknown) => new NextRequest("http://crm.test/api/v1/intern/rueckfragen", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = (query: string) => new NextRequest(`http://crm.test/api/v1/intern/rueckfragen${query}`);

describe("/api/v1/intern/rueckfragen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue(admin);
  });

  it("POST legt Fragen an und liefert Codes", async () => {
    mocks.erstelleRueckfragen.mockResolvedValue({ codes: ["R7K2"], zugestellt: true });
    const response = await POST(post({ quelle: "kassensturz", fragen: [{ frage: "Wer war dabei?", optionen: ["privat"], payload: { tx_id: "a1", kind: "bewirtung" } }] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { codes: ["R7K2"], zugestellt: true } });
    expect(mocks.erstelleRueckfragen).toHaveBeenCalledWith("ws1", { quelle: "kassensturz", fragen: [{ frage: "Wer war dabei?", optionen: ["privat"], payload: { tx_id: "a1", kind: "bewirtung" }, ablaufTage: 7 }] });
  });

  it("POST: 401 ohne Anmeldung, 403 ohne Admin, 400 bei ungültigem Body, kaputtem JSON oder unbekanntem Empfänger", async () => {
    mocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await POST(post({}))).status).toBe(401);
    mocks.getAuthContext.mockResolvedValueOnce({ ...admin, workspaceRole: "member" });
    expect((await POST(post({ quelle: "kassensturz", fragen: [{ frage: "x", optionen: [] }] }))).status).toBe(403);
    expect((await POST(post({ quelle: "Kassen Sturz", fragen: [] }))).status).toBe(400);
    expect((await POST(new NextRequest("http://crm.test/api/v1/intern/rueckfragen", { method: "POST", body: "{kaputt" }))).status).toBe(400);
    mocks.erstelleRueckfragen.mockRejectedValueOnce(new RueckfrageFehler("Paula ist keine interne Nummer"));
    const fremd = await POST(post({ quelle: "kassensturz", empfaenger: "Paula", fragen: [{ frage: "x", optionen: [] }] }));
    expect(fremd.status).toBe(400);
    expect((await fremd.json()).error.message).toContain("Paula");
    expect(mocks.erstelleRueckfragen).toHaveBeenCalledTimes(1);
  });

  it("GET liefert beantwortete Fragen seit einem Zeitpunkt", async () => {
    mocks.listeRueckfragen.mockResolvedValue([{ code: "R7K2", antwort: "privat" }]);
    const response = await GET(get("?quelle=kassensturz&seit=2026-10-23T08:00:00.000Z"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { rueckfragen: [{ code: "R7K2", antwort: "privat" }] } });
    expect(mocks.listeRueckfragen).toHaveBeenCalledWith("ws1", { quelle: "kassensturz", status: "beantwortet", seit: new Date("2026-10-23T08:00:00.000Z") });
  });

  it("GET: 400 ohne Quelle, mit falschem Status oder Datum; 403 ohne Admin", async () => {
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get("?quelle=kassensturz&status=alle"))).status).toBe(400);
    expect((await GET(get("?quelle=kassensturz&seit=gestern"))).status).toBe(400);
    mocks.getAuthContext.mockResolvedValueOnce({ ...admin, workspaceRole: "member" });
    expect((await GET(get("?quelle=kassensturz"))).status).toBe(403);
    expect(mocks.listeRueckfragen).not.toHaveBeenCalled();
  });
});
