import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_DOCUMENT_SIZE,
  validateProjectDocumentUpload,
} from "./project-documents";

describe("validateProjectDocumentUpload", () => {
  it("caps the file at 10 MB, exactly like deal_documents", () => {
    expect(MAX_PROJECT_DOCUMENT_SIZE).toBe(10 * 1024 * 1024);
  });

  it("accepts a normal PDF", () => {
    expect(
      validateProjectDocumentUpload({
        fileName: "Konzept.pdf",
        mimeType: "application/pdf",
        fileSize: 250_000,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts a file of exactly the cap", () => {
    expect(
      validateProjectDocumentUpload({
        fileName: "gross.pdf",
        mimeType: "application/pdf",
        fileSize: MAX_PROJECT_DOCUMENT_SIZE,
      }).ok,
    ).toBe(true);
  });

  it("rejects one byte over the cap with 413", () => {
    expect(
      validateProjectDocumentUpload({
        fileName: "zu-gross.pdf",
        mimeType: "application/pdf",
        fileSize: MAX_PROJECT_DOCUMENT_SIZE + 1,
      }),
    ).toEqual({ ok: false, status: 413, error: "Datei ist zu groß (max. 10 MB)." });
  });

  it("rejects an empty file name with 400", () => {
    expect(
      validateProjectDocumentUpload({ fileName: "   ", mimeType: "application/pdf", fileSize: 10 }),
    ).toEqual({ ok: false, status: 400, error: "Dateiname fehlt." });
  });

  it("rejects an empty file with 400", () => {
    expect(
      validateProjectDocumentUpload({ fileName: "leer.pdf", mimeType: "application/pdf", fileSize: 0 }),
    ).toEqual({ ok: false, status: 400, error: "Die Datei ist leer." });
  });
});
