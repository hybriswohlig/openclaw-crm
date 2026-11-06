import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDealDocument: vi.fn(),
  applyInvoiceDueDate: vi.fn(),
}));

vi.mock("@/services/deal-documents", () => ({
  createDealDocument: mocks.createDealDocument,
}));

vi.mock("@/services/rechnung-faellig", () => ({
  applyInvoiceDueDate: mocks.applyInvoiceDueDate,
}));

import { persistCommercialDocument } from "./commercial-documents";

const stored = {
  id: "doc_1",
  documentType: "invoice" as const,
  fileName: "RE.pdf",
  fileSize: 8,
  mimeType: "application/pdf",
  uploadedAt: new Date("2026-11-02T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDealDocument.mockResolvedValue(stored);
  mocks.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: "2026-11-02" });
});

describe("persistCommercialDocument", () => {
  it("sets Rechnung fällig am when an RE is stored, and keeps an explicit day", async () => {
    const result = await persistCommercialDocument({
      workspaceId: "ws",
      dealRecordId: "deal_1",
      kind: "RE",
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      fileStem: "RE-ceylan-2026-11-02",
      templateVersion: "kv-ab-re/2",
      dueDate: "2026-12-01",
      updatedBy: "usr_1",
      now: new Date("2026-11-02T12:00:00.000Z"),
    });

    expect(mocks.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "invoice",
        dealRecordId: "deal_1",
        mimeType: "application/pdf",
      })
    );
    expect(mocks.applyInvoiceDueDate).toHaveBeenCalledWith({
      documentType: "invoice",
      workspaceId: "ws",
      dealRecordId: "deal_1",
      explicitDueDate: "2026-12-01",
      updatedBy: "usr_1",
      now: new Date("2026-11-02T12:00:00.000Z"),
    });
    expect(result.rechnungFaelligAm).toBe("2026-11-02");
    expect(result.fileName).toMatch(/^RE-ceylan-2026-11-02-/);
  });

  it("does not stamp a KV", async () => {
    const result = await persistCommercialDocument({
      workspaceId: "ws",
      dealRecordId: "deal_1",
      kind: "KV",
      pdf: new Uint8Array([0x25]),
      fileStem: "KV-ceylan",
      templateVersion: "kv-ab-re/2",
    });
    expect(mocks.applyInvoiceDueDate).not.toHaveBeenCalled();
    expect(result.rechnungFaelligAm).toBeNull();
    expect(mocks.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "quotation" })
    );
  });

  it("passes the rendered calculation version only for a KV", async () => {
    const base = { workspaceId: "ws", dealRecordId: "deal_1", pdf: new Uint8Array([0x25]), fileStem: "X", templateVersion: "kv-ab-re/2" };
    await persistCommercialDocument({ ...base, kind: "KV", calculationVersionId: "ver_2" });
    expect(mocks.createDealDocument).toHaveBeenLastCalledWith(expect.objectContaining({ documentType: "quotation", calculationVersionId: "ver_2" }));
    await persistCommercialDocument({ ...base, kind: "KV" });
    expect(mocks.createDealDocument).toHaveBeenLastCalledWith(expect.objectContaining({ calculationVersionId: null }));
    await persistCommercialDocument({ ...base, kind: "RE", calculationVersionId: "ver_2" });
    expect(mocks.createDealDocument).toHaveBeenLastCalledWith(expect.objectContaining({ documentType: "invoice", calculationVersionId: null }));
  });
});
