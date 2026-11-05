/**
 * CRM-Renderer: der KV wird mit der Kalkulationsversion der Quotation gespeichert,
 * aus der er gerendert wurde, nicht mit der, auf die die Quotation beim Speichern
 * zeigt (Review 4). Datenbank und Chromium sind ersetzt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuotation: vi.fn(),
  createDealDocument: vi.fn(),
  renderPdf: vi.fn(),
}));

// Jede Abfrage: Objekt-Zeilen gibt es, sonst leer (keine Annahme, keine Zahlungen, kein Auftrag).
vi.mock("@/db", async () => {
  const { objects } = await import("@/db/schema/objects");
  const kette = (): unknown => {
    let tabelle: unknown = null;
    const k: Record<string, unknown> = {};
    for (const f of ["from", "innerJoin", "where", "limit", "orderBy"]) {
      k[f] = (t: unknown) => {
        if (f === "from") tabelle = t;
        return k;
      };
    }
    k.then = (ok: (v: unknown) => unknown, fehler: (e: unknown) => unknown) =>
      Promise.resolve(tabelle === objects ? [{ id: "obj_1" }] : []).then(ok, fehler);
    return k;
  };
  return { db: { select: () => kette() } };
});
vi.mock("@/services/document-job-context", () => ({ assertDealInWorkspace: async () => true }));
vi.mock("@/services/quotations", () => ({ getQuotation: mocks.getQuotation }));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Kyra", nachname: "Heiker", fullName: "Kyra Heiker", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/records", () => ({
  getRecord: async (_objekt: string, id: string) =>
    id === "deal_1"
      ? { values: { name: "Umzug Heiker", operating_company: { id: "oc_ceylan", displayName: "Ceylan Umzüge" } } }
      : { values: {} },
}));
vi.mock("@/services/agent/agent-suppress", () => ({
  ladeGespeicherteAnrede: async () => ({}),
  anredeFuerOptOut: () => "sie",
}));
vi.mock("@/services/deal-documents", () => ({ createDealDocument: mocks.createDealDocument }));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: vi.fn() }));
vi.mock("@openclaw-crm/document-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw-crm/document-templates")>()),
  renderPdf: mocks.renderPdf,
}));

import { previewCommercialDocument, storeCommercialDocument } from "./commercial-documents";

const angebot = (calculationVersionId: string | null, fixedPrice: string) => ({
  id: "q1",
  dealRecordId: "deal_1",
  fixedPrice,
  isVariable: false,
  notes: null,
  summary: null,
  validUntil: null,
  depositRequiredCents: null,
  paymentMethodPreference: null,
  showStandardInclusions: true,
  selectedPackageOptionId: null,
  serviceType: "move",
  documentDetails: null,
  calculationAssumptions: null,
  calculationVersionId,
  lineItems: [{ id: "l1", quotationId: "q1", type: "other", description: "Umzug", quantity: 1, unitRate: fixedPrice, sortOrder: 0 }],
});

const DOKUMENT = { id: "doc_1", documentType: "quotation", fileName: "KV.pdf", fileSize: 4, mimeType: "application/pdf", uploadedAt: new Date() };
const eingabe = { workspaceId: "ws_1", dealRecordId: "deal_1", kind: "KV" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDealDocument.mockResolvedValue(DOKUMENT);
  mocks.getQuotation.mockResolvedValue(angebot("ver_1", "1000.00"));
  // Während des Renderns sperrt jemand v2 (1.500 €): die Quotation zeigt danach auf v2.
  mocks.renderPdf.mockImplementation(async () => {
    mocks.getQuotation.mockResolvedValue(angebot("ver_2", "1500.00"));
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  });
});

describe("CRM-Renderer und Kalkulationsversion (Review 4)", () => {
  it("Vorschau nennt die Version der gerenderten Quotation", async () => {
    const r = await previewCommercialDocument(eingabe);
    expect(r.calculationVersionId).toBe("ver_1");
    expect(r.html).toContain("1.000,00");
  });

  it("KV wird mit der gerenderten Version (v1) gespeichert, auch wenn bis zum Speichern v2 gesperrt wurde", async () => {
    await storeCommercialDocument(eingabe);
    expect(mocks.createDealDocument).toHaveBeenCalledTimes(1);
    expect(mocks.createDealDocument).toHaveBeenCalledWith(expect.objectContaining({ documentType: "quotation", calculationVersionId: "ver_1" }));
  });

  it("Quotation ohne Version → null", async () => {
    mocks.getQuotation.mockResolvedValue(angebot(null, "1000.00"));
    mocks.renderPdf.mockResolvedValue(new Uint8Array([0x25]));
    await storeCommercialDocument(eingabe);
    expect(mocks.createDealDocument).toHaveBeenCalledWith(expect.objectContaining({ calculationVersionId: null }));
  });

  it("pruefeVersion bekommt die gerenderte Version; wirft sie, wird nichts gespeichert", async () => {
    const pruefeVersion = vi.fn(async (id: string | null) => {
      if (id !== "ver_2") throw new Error("nicht v2");
    });
    await expect(storeCommercialDocument({ ...eingabe, pruefeVersion })).rejects.toThrow("nicht v2");
    expect(pruefeVersion).toHaveBeenCalledWith("ver_1");
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });
});
