import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ensureDealCalculation: vi.fn(),
  getQuotation: vi.fn(),
  upsertQuotation: vi.fn(),
  ensureCustomerStatusLink: vi.fn(),
  captureScopeSnapshot: vi.fn(),
  completeAgentPriceTasks: vi.fn(),
  lesen: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/rechner/kalkulation", () => ({ ensureDealCalculation: mocks.ensureDealCalculation }));
vi.mock("@/services/rechner/speicher", () => ({ dbSpeicher: { lesen: mocks.lesen, speichern: vi.fn() } }));
vi.mock("@/services/quotations", () => ({ getQuotation: mocks.getQuotation, upsertQuotation: mocks.upsertQuotation }));
vi.mock("@/services/customer-portal-data", () => ({ ensureCustomerStatusLink: mocks.ensureCustomerStatusLink }));
vi.mock("@/services/scope-guard", () => ({ captureScopeSnapshot: mocks.captureScopeSnapshot }));
vi.mock("@/services/agent/agent-tasks", () => ({ completeAgentPriceTasks: mocks.completeAgentPriceTasks }));

import { GET, POST } from "./route";
import { POST as APPLY } from "./apply/route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation", {
    method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" },
  });
const zeile = (result: unknown) => ({
  dealRecordId: "deal_1", workspaceId: "ws_1", inputHash: "h", request: { von_etage: "1" }, result, error: null, computedAt: new Date(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ensureCustomerStatusLink.mockResolvedValue(undefined);
});

describe("GET/POST /calculation", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(req(), { params })).status).toBe(401);
    expect((await POST(req(), { params })).status).toBe(401);
    expect((await APPLY(req({}), { params })).status).toBe(401);
  });

  it("GET rechnet bei Bedarf (ohne force) und liefert die Kalkulation", async () => {
    mocks.ensureDealCalculation.mockResolvedValue({ status: "unveraendert", kalkulation: zeile({ preis: { festpreis: 900 } }) });
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(mocks.ensureDealCalculation).toHaveBeenCalledWith("ws_1", "deal_1", { force: false });
    expect((await res.json()).data.kalkulation.result.preis.festpreis).toBe(900);
  });

  it("POST rechnet erzwungen neu", async () => {
    mocks.ensureDealCalculation.mockResolvedValue({ status: "neu", kalkulation: zeile({}) });
    await POST(req(), { params });
    expect(mocks.ensureDealCalculation).toHaveBeenCalledWith("ws_1", "deal_1", { force: true });
  });

  it("ein Absturz in der Kalkulation macht die Seite nicht kaputt: letzte gespeicherte Kalkulation, Status fehler", async () => {
    mocks.ensureDealCalculation.mockRejectedValue(new Error("DB weg"));
    mocks.lesen.mockResolvedValue(zeile({ preis: { festpreis: 800 } }));
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("fehler");
    expect(body.data.kalkulation.result.preis.festpreis).toBe(800);
  });
});

describe("POST /calculation/apply", () => {
  it("nur Spanne ohne Bestätigung: 400, Angebot unverändert", async () => {
    mocks.lesen.mockResolvedValue(zeile({ schaetzung: { festpreisVon: 900, festpreisBis: 1800, annahmen: [] } }));
    mocks.getQuotation.mockResolvedValue(null);
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(400);
    expect(mocks.upsertQuotation).not.toHaveBeenCalled();
  });

  it("Festpreis: setzt fixedPrice, übergibt vorhandene Notizen, keine lineItems, Nachlauf wie beim Speichern", async () => {
    mocks.lesen.mockResolvedValue(zeile({ preis: { festpreis: 1490 }, schaetzung: null }));
    mocks.getQuotation.mockResolvedValue({ notes: "Klavier", isVariable: true });
    mocks.upsertQuotation.mockResolvedValue({ fixedPrice: "1490" });
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(200);
    const [dealId, eingabe] = mocks.upsertQuotation.mock.calls[0]!;
    expect(dealId).toBe("deal_1");
    expect(eingabe).toMatchObject({ fixedPrice: "1490", isVariable: false, notes: "Klavier" });
    expect(eingabe).not.toHaveProperty("lineItems");
    expect(mocks.captureScopeSnapshot).toHaveBeenCalledWith("ws_1", "deal_1", "issue");
    expect(mocks.completeAgentPriceTasks).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Kalkulation eines anderen Workspace wird nicht übernommen", async () => {
    mocks.lesen.mockResolvedValue({ ...zeile({ preis: { festpreis: 1 } }), workspaceId: "ws_fremd" });
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(400);
    expect(mocks.upsertQuotation).not.toHaveBeenCalled();
  });
});
