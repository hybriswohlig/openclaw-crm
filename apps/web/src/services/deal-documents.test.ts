import { describe, expect, it } from "vitest";
import {
  MAX_DEAL_DOCUMENT_SIZE,
  deduceDocumentType,
  parseFilenameFromContentDisposition,
  validateDealDocumentUpload,
} from "./deal-documents";

describe("validateDealDocumentUpload", () => {
  it("caps the file at 10 MB", () => {
    expect(MAX_DEAL_DOCUMENT_SIZE).toBe(10 * 1024 * 1024);
  });

  it("accepts a typical KV PDF well over the Vercel 4.5 MB hop limit", () => {
    expect(
      validateDealDocumentUpload({
        fileName: "KV-KO-20260907-FLO-2.pdf",
        fileSize: 5 * 1024 * 1024,
        documentType: "quotation",
      })
    ).toEqual({ ok: true, documentType: "quotation" });
  });

  it("accepts a file of exactly the cap", () => {
    expect(
      validateDealDocumentUpload({
        fileName: "gross.pdf",
        fileSize: MAX_DEAL_DOCUMENT_SIZE,
        documentType: "quotation",
      }).ok
    ).toBe(true);
  });

  it("rejects one byte over the cap with 413", () => {
    expect(
      validateDealDocumentUpload({
        fileName: "zu-gross.pdf",
        fileSize: MAX_DEAL_DOCUMENT_SIZE + 1,
        documentType: "quotation",
      })
    ).toEqual({ ok: false, status: 413, error: "File too large (max 10 MB)" });
  });

  it("rejects an unknown documentType with 400", () => {
    expect(
      validateDealDocumentUpload({
        fileName: "x.pdf",
        fileSize: 10,
        documentType: "not-a-type",
      })
    ).toEqual({ ok: false, status: 400, error: "Invalid documentType" });
  });
});

describe("deduceDocumentType", () => {
  it("maps KV / MUSTER-KV / AB / RE / AW prefixes", () => {
    expect(deduceDocumentType("KV-KO-20260907-FLO-2.pdf")).toBe("quotation");
    expect(deduceDocumentType("MUSTER-KV-KO-20260907.pdf")).toBe("quotation");
    expect(deduceDocumentType("AB-KO-20260907.pdf")).toBe("order_confirmation");
    expect(deduceDocumentType("RE-KO-20260907.pdf")).toBe("invoice");
    expect(deduceDocumentType("AW-KO-20260907.pdf")).toBe("worker_instructions");
    expect(deduceDocumentType("unknown.pdf")).toBeNull();
  });
});

describe("parseFilenameFromContentDisposition", () => {
  it("reads a quoted filename", () => {
    expect(
      parseFilenameFromContentDisposition(
        'attachment; filename="KV-KO-20260907-FLO-2.pdf"'
      )
    ).toBe("KV-KO-20260907-FLO-2.pdf");
  });

  it("returns null when the header is missing", () => {
    expect(parseFilenameFromContentDisposition(null)).toBeNull();
  });
});
