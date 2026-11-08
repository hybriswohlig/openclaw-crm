import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Plan 14, Task Z: PUT /quotation zählt jeden Aufruf (Quelle, Schlüssel, Feldnamen)
 * und lehnt in Stufe „sperren“ alles außer der Oberfläche mit 410 ab.
 */

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  emitEvent: vi.fn(),
  upsertQuotation: vi.fn(),
  ensureCustomerStatusLink: vi.fn(),
  captureScopeSnapshot: vi.fn(),
  completeAgentPriceTasks: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/activity-events", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("@/services/quotations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/quotations")>();
  return { ...actual, upsertQuotation: mocks.upsertQuotation };
});
vi.mock("@/services/customer-portal-data", () => ({ ensureCustomerStatusLink: mocks.ensureCustomerStatusLink }));
vi.mock("@/services/scope-guard", () => ({ captureScopeSnapshot: mocks.captureScopeSnapshot }));
vi.mock("@/services/agent/agent-tasks", () => ({ completeAgentPriceTasks: mocks.completeAgentPriceTasks }));

import { PUT } from "./route";

const SITZUNG = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, permissions: {}, authMethod: "cookie" as const };
const SCHLUESSEL = { ...SITZUNG, authMethod: "api_key" as const, apiKeyAccess: "full" as const, apiKeyId: "key_7" };
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/quotation", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
const BODY = { isVariable: false, fixedPrice: "1890.00", notes: "geheim", lineItems: [{ type: "other", quantity: 1, unitRate: 1890, sortOrder: 0 }] };

function letzteZaehlung() {
  expect(mocks.emitEvent).toHaveBeenCalledTimes(1);
  return mocks.emitEvent.mock.calls[0][0] as {
    workspaceId: string;
    recordId: string | null;
    objectSlug: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    actorId: string;
  };
}

let stufeVorher: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  stufeVorher = process.env.QUOTATION_PUT_STUFE;
  delete process.env.QUOTATION_PUT_STUFE;
  mocks.getAuthContext.mockResolvedValue(SITZUNG);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.upsertQuotation.mockResolvedValue({ id: "q1", fixedPrice: "1890.00" });
  mocks.ensureCustomerStatusLink.mockResolvedValue(undefined);
  mocks.captureScopeSnapshot.mockResolvedValue(undefined);
  mocks.completeAgentPriceTasks.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (stufeVorher === undefined) delete process.env.QUOTATION_PUT_STUFE;
  else process.env.QUOTATION_PUT_STUFE = stufeVorher;
  vi.restoreAllMocks();
});

describe("PUT /quotation: Prüfungen vor dem Zählen", () => {
  it("antwortet 401 ohne Anmeldung und zählt nicht", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await PUT(put(BODY), p());
    expect(res.status).toBe(401);
    expect(mocks.emitEvent).not.toHaveBeenCalled();
  });

  it("antwortet 404 für einen Deal aus fremdem Workspace, ohne Ereignis und ohne Schreiben", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await PUT(put(BODY), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.upsertQuotation).not.toHaveBeenCalled();
  });

  it("antwortet 403 für einen Nur-Lese-Schlüssel", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...SCHLUESSEL, apiKeyAccess: "read" });
    const res = await PUT(put(BODY), p());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.upsertQuotation).not.toHaveBeenCalled();
  });
});

describe("PUT /quotation: Stufe zählen", () => {
  it("schreibt ein Ereignis ohne Datensatz mit Feldnamen, ohne Werte", async () => {
    const res = await PUT(put(BODY, { "x-crm-client": "ui" }), p());
    expect(res.status).toBe(200);
    const e = letzteZaehlung();
    expect(e).toMatchObject({ workspaceId: "ws_1", recordId: null, objectSlug: null, eventType: "quotation.put", actorId: "usr_1" });
    expect(e.payload).toEqual({
      quelle: "ui",
      stufe: "zaehlen",
      abgelehnt: false,
      dealRecordId: "deal_1",
      apiKeyId: null,
      felder: ["fixedPrice", "isVariable", "lineItems", "notes"],
    });
    expect(JSON.stringify(e.payload)).not.toContain("geheim");
    expect(JSON.stringify(e.payload)).not.toContain("1890");
    expect(console.warn).toHaveBeenCalledWith("[quotation-put]", expect.objectContaining({ quelle: "ui", dealRecordId: "deal_1" }));
  });

  it.each([
    ["Sitzung mit UI-Header", SITZUNG, { "x-crm-client": "ui" }, "ui", null],
    ["Sitzung ohne Header", SITZUNG, {}, "sitzung", null],
    ["API-Schlüssel", SCHLUESSEL, {}, "api_schluessel", "key_7"],
    ["API-Schlüssel mit gefälschtem UI-Header", SCHLUESSEL, { "x-crm-client": "ui" }, "api_schluessel", "key_7"],
    ["MCP-Werkzeug", SCHLUESSEL, { "x-crm-mcp-tool": "crm_update_deal_quotation" }, "mcp_werkzeug", "key_7"],
    ["MCP crm_api", SCHLUESSEL, { "x-crm-mcp-tool": "crm_api" }, "mcp_crm_api", "key_7"],
    ["MCP crm_api mit Sitzung", SITZUNG, { "x-crm-mcp-tool": "crm_api", "x-crm-client": "ui" }, "mcp_crm_api", null],
  ] as const)("erkennt die Quelle: %s", async (_name, ctx, headers, quelle, apiKeyId) => {
    mocks.getAuthContext.mockResolvedValue(ctx);
    const res = await PUT(put(BODY, headers), p());
    expect(res.status).toBe(200);
    expect(letzteZaehlung().payload).toMatchObject({ quelle, apiKeyId, abgelehnt: false, stufe: "zaehlen" });
    expect(mocks.upsertQuotation).toHaveBeenCalledWith("deal_1", BODY);
  });

  it("behält die Nebenwirkungen (Status-Link, Scope-Baseline, KI-Preisaufgabe)", async () => {
    const res = await PUT(put(BODY), p());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "q1", fixedPrice: "1890.00" } });
    expect(mocks.ensureCustomerStatusLink).toHaveBeenCalledWith({ workspaceId: "ws_1", dealRecordId: "deal_1", createdBy: "usr_1" });
    expect(mocks.captureScopeSnapshot).toHaveBeenCalledWith("ws_1", "deal_1", "issue");
    expect(mocks.completeAgentPriceTasks).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("begrenzt die Feldnamen auf 30 zu je 40 Zeichen", async () => {
    const body: Record<string, number> = { isVariable: 0 };
    for (let i = 0; i < 50; i++) body[`feld${String(i).padStart(2, "0")}${"x".repeat(60)}`] = i;
    await PUT(put(body), p());
    const felder = letzteZaehlung().payload.felder as string[];
    expect(felder).toHaveLength(30);
    expect(Math.max(...felder.map((f) => f.length))).toBe(40);
    expect(felder[0]).toBe(`feld00${"x".repeat(34)}`);
  });

  it("zählt auch einen kaputten Body und antwortet dann 400", async () => {
    const res = await PUT(put("{kaputt"), p());
    expect(res.status).toBe(400);
    expect(letzteZaehlung().payload).toMatchObject({ felder: [], abgelehnt: false });
    expect(mocks.upsertQuotation).not.toHaveBeenCalled();
  });

  it("wertet jeden anderen Wert der Variable als zählen", async () => {
    process.env.QUOTATION_PUT_STUFE = "Sperren";
    const res = await PUT(put(BODY), p());
    expect(res.status).toBe(200);
    expect(letzteZaehlung().payload).toMatchObject({ stufe: "zaehlen" });
  });
});

describe("PUT /quotation: Stufe sperren", () => {
  beforeEach(() => {
    process.env.QUOTATION_PUT_STUFE = "sperren";
  });

  it("lässt die Oberfläche schreiben, mit allen Nebenwirkungen", async () => {
    const res = await PUT(put(BODY, { "x-crm-client": "ui" }), p());
    expect(res.status).toBe(200);
    expect(letzteZaehlung().payload).toMatchObject({ quelle: "ui", stufe: "sperren", abgelehnt: false });
    expect(mocks.upsertQuotation).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCustomerStatusLink).toHaveBeenCalledTimes(1);
    expect(mocks.captureScopeSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.completeAgentPriceTasks).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Sitzung ohne Header", SITZUNG, {}],
    ["API-Schlüssel mit gefälschtem UI-Header", SCHLUESSEL, { "x-crm-client": "ui" }],
    ["MCP-Werkzeug", SCHLUESSEL, { "x-crm-mcp-tool": "crm_update_deal_quotation" }],
    ["MCP crm_api", SCHLUESSEL, { "x-crm-mcp-tool": "crm_api" }],
  ] as const)("lehnt %s mit 410 und Verweis ab und zählt abgelehnt", async (_name, ctx, headers) => {
    mocks.getAuthContext.mockResolvedValue(ctx);
    const res = await PUT(put(BODY, headers), p());
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error.code).toBe("QUOTATION_PUT_GONE");
    expect(json.error.ersatz).toContain("crm_update_quotation_details");
    expect(letzteZaehlung().payload).toMatchObject({ stufe: "sperren", abgelehnt: true });
    expect(mocks.upsertQuotation).not.toHaveBeenCalled();
    expect(mocks.ensureCustomerStatusLink).not.toHaveBeenCalled();
    expect(mocks.captureScopeSnapshot).not.toHaveBeenCalled();
    expect(mocks.completeAgentPriceTasks).not.toHaveBeenCalled();
  });
});
