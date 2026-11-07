import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  setQuotationDetails: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/quotation-details", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/quotation-details")>();
  return { ...actual, setQuotationDetails: mocks.setQuotationDetails };
});

import { PATCH } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, permissions: {}, authMethod: "api_key" as const, apiKeyAccess: "full" as const, apiKeyId: "k1" };
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/quotation/details", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.setQuotationDetails.mockResolvedValue({ ok: true, quotation: { id: "q1", notes: "n" } });
});

describe("PATCH /quotation/details", () => {
  it("antwortet 401 ohne Anmeldung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await PATCH(patch({ notes: "x" }), p())).status).toBe(401);
    expect(mocks.setQuotationDetails).not.toHaveBeenCalled();
  });

  it("antwortet 403 für einen Nur-Lese-Schlüssel", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, apiKeyAccess: "read" });
    const res = await PATCH(patch({ notes: "x" }), p());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    expect(mocks.setQuotationDetails).not.toHaveBeenCalled();
  });

  it("antwortet 404 für einen Deal aus fremdem Workspace", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    expect((await PATCH(patch({ notes: "x" }), p())).status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.setQuotationDetails).not.toHaveBeenCalled();
  });

  it.each([
    ["kaputtes JSON", "{x", "Invalid JSON body"],
    ["leerer Body", {}, "Keine Felder angegeben"],
    ["Festpreis", { fixedPrice: "100" }, "Unbekannte Felder: fixedPrice"],
    ["Rabatt und Posten", { notes: "x", discount: { amount: 50 }, lineItems: [] }, "Unbekannte Felder: discount, lineItems"],
    ["Version", { calculationVersionId: "v2" }, "Unbekannte Felder: calculationVersionId"],
    ["Tag, den es nicht gibt", { validUntil: "2026-02-31" }, "validUntil muss YYYY-MM-DD oder null sein"],
    ["unbekannter Zahlungsweg", { paymentMethodPreference: "bitcoin" }, "paymentMethodPreference muss bank_transfer, paypal, cash, card oder null sein"],
    ["falsche Leistung", { serviceType: "umzug" }, "serviceType muss einer von move, kitchen_installation, clearance, clearance_move sein"],
  ])("antwortet 400 bei %s", async (_name, body, meldung) => {
    const res = await PATCH(patch(body), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(meldung);
    expect(mocks.setQuotationDetails).not.toHaveBeenCalled();
  });

  it("gibt den geprüften Patch an den Dienst und die Quotation zurück", async () => {
    const res = await PATCH(patch({ notes: "  intern  ", validUntil: "2026-02-28", paymentMethodPreference: null, serviceType: "kitchen_installation" }), p());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "q1", notes: "n" } });
    expect(mocks.setQuotationDetails).toHaveBeenCalledWith("ws_1", "deal_1", {
      notes: "intern",
      validUntil: "2026-02-28",
      paymentMethodPreference: null,
      serviceType: "kitchen_installation",
    });
  });

  it("antwortet 404 mit Hinweis, wenn es noch keine Quotation gibt", async () => {
    mocks.setQuotationDetails.mockResolvedValue({ ok: false, status: 404, code: "QUOTATION_NOT_FOUND" });
    const res = await PATCH(patch({ notes: "x" }), p());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("QUOTATION_NOT_FOUND");
    expect(json.error.message).toContain("Erst eine Kalkulationsversion sperren");
  });

  it("antwortet 409 KVA_ACCEPTED nach der Annahme", async () => {
    mocks.setQuotationDetails.mockResolvedValue({ ok: false, status: 409, code: "KVA_ACCEPTED" });
    const res = await PATCH(patch({ summary: "x" }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("KVA_ACCEPTED");
  });

  it("antwortet 404, wenn der Dienst den Deal nicht findet", async () => {
    mocks.setQuotationDetails.mockResolvedValue({ ok: false, status: 404, code: "NOT_FOUND" });
    expect((await PATCH(patch({ notes: "x" }), p())).status).toBe(404);
  });
});
