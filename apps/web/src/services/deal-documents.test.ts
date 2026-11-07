import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JSON_INLINE_BYTES } from "@/lib/attachment-content";

const mocks = vi.hoisted(() => ({
  insertReturning: vi.fn(),
  insertValues: vi.fn(),
  selectLimit: vi.fn(async () => [] as unknown[]),
  selectFrom: vi.fn(),
  maybeNotifyPortalEvent: vi.fn(),
  aktualisiereWartet: vi.fn(),
  dealImWorkspace: vi.fn(async () => true),
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        mocks.insertValues(v);
        return { returning: mocks.insertReturning };
      },
    }),
    select: () => ({
      from: (t: unknown) => {
        mocks.selectFrom(t);
        return { where: () => ({ limit: mocks.selectLimit }) };
      },
    }),
  },
}));

vi.mock("./customer-portal-notifications", () => ({
  maybeNotifyPortalEvent: mocks.maybeNotifyPortalEvent,
}));

vi.mock("./wartet", () => ({ aktualisiereWartet: mocks.aktualisiereWartet }));

vi.mock("./deal-attribution", () => ({
  advanceDealToQuotedIfEarlier: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/kalkulation-versionen-antwort", () => ({
  dealImWorkspace: mocks.dealImWorkspace,
}));

import {
  MAX_DEAL_DOCUMENT_SIZE,
  createDealDocument,
  deduceDocumentType,
  jsonDealDocumentTooLargeMessage,
  parseFilenameFromContentDisposition,
  prepareJsonDealDocument,
  shouldNotifyDealDocument,
  validateDealDocumentUpload,
} from "./deal-documents";
import { quotations } from "@/db/schema/quotations";

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

describe("prepareJsonDealDocument", () => {
  const smallPdf = Buffer.from("%PDF-1.4 corrected invoice");

  it("accepts a base64 PDF and defaults the mime type", () => {
    const prepared = prepareJsonDealDocument({
      fileName: " RE-korrigiert.pdf ",
      documentType: "invoice",
      mimeType: "  ",
      contentBase64: smallPdf.toString("base64"),
    });
    expect(prepared).toEqual({
      ok: true,
      fileName: "RE-korrigiert.pdf",
      documentType: "invoice",
      mimeType: "application/pdf",
      fileSize: smallPdf.length,
      fileContent: smallPdf.toString("base64"),
    });
  });

  it("strips a data-URL prefix", () => {
    const prepared = prepareJsonDealDocument({
      fileName: "RE-korrigiert.pdf",
      documentType: "invoice",
      mimeType: undefined,
      contentBase64: `data:application/pdf;base64,${smallPdf.toString("base64")}`,
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.fileContent).toBe(smallPdf.toString("base64"));
  });

  it("rejects a bad documentType", () => {
    expect(
      prepareJsonDealDocument({
        fileName: "x.pdf",
        documentType: "not-a-type",
        mimeType: "application/pdf",
        contentBase64: smallPdf.toString("base64"),
      })
    ).toEqual({ ok: false, status: 400, error: "Invalid documentType" });
  });

  it("rejects invalid base64", () => {
    expect(
      prepareJsonDealDocument({
        fileName: "x.pdf",
        documentType: "invoice",
        mimeType: "application/pdf",
        contentBase64: "not base64!!!",
      })
    ).toEqual({ ok: false, status: 400, error: "contentBase64 is not valid base64" });
  });

  it("rejects one byte over the JSON cap with the Vercel limit message", () => {
    const pdf = Buffer.alloc(MAX_JSON_INLINE_BYTES + 1, 0x25);
    expect(
      prepareJsonDealDocument({
        fileName: "zu-gross.pdf",
        documentType: "invoice",
        mimeType: "application/pdf",
        contentBase64: pdf.toString("base64"),
      })
    ).toEqual({
      ok: false,
      status: 413,
      error: jsonDealDocumentTooLargeMessage(),
    });
    expect(jsonDealDocumentTooLargeMessage()).toContain("4.5 MB");
    expect(jsonDealDocumentTooLargeMessage()).toContain(String(MAX_JSON_INLINE_BYTES));
  });

  it("still enforces the 10 MB application cap", () => {
    const pdf = Buffer.alloc(MAX_DEAL_DOCUMENT_SIZE + 1, 0x25);
    expect(
      prepareJsonDealDocument({
        fileName: "zu-gross.pdf",
        documentType: "invoice",
        mimeType: "application/pdf",
        contentBase64: pdf.toString("base64"),
      })
    ).toEqual({ ok: false, status: 413, error: "File too large (max 10 MB)" });
  });
});

describe("shouldNotifyDealDocument", () => {
  it("notifies only order_confirmation and invoice, and only when the flag is not false", () => {
    expect(shouldNotifyDealDocument("invoice", undefined)).toBe(true);
    expect(shouldNotifyDealDocument("invoice", true)).toBe(true);
    expect(shouldNotifyDealDocument("order_confirmation", undefined)).toBe(true);
    expect(shouldNotifyDealDocument("invoice", false)).toBe(false);
    expect(shouldNotifyDealDocument("order_confirmation", false)).toBe(false);
    expect(shouldNotifyDealDocument("quotation", true)).toBe(false);
    expect(shouldNotifyDealDocument("payment_confirmation", undefined)).toBe(false);
    expect(shouldNotifyDealDocument("worker_instructions", true)).toBe(false);
  });
});

describe("createDealDocument notifications", () => {
  const stored = {
    id: "doc_1",
    documentType: "invoice" as const,
    fileName: "RE-korrigiert.pdf",
    fileSize: 4,
    mimeType: "application/pdf",
    uploadedAt: new Date("2026-10-14T00:00:00.000Z"),
  };

  beforeEach(() => {
    mocks.insertReturning.mockReset();
    mocks.maybeNotifyPortalEvent.mockReset();
    mocks.insertReturning.mockResolvedValue([stored]);
    mocks.maybeNotifyPortalEvent.mockResolvedValue(undefined);
    mocks.aktualisiereWartet.mockReset();
    mocks.aktualisiereWartet.mockResolvedValue(undefined);
  });

  const base = {
    workspaceId: "ws_kottke_prod",
    dealRecordId: "deal_1",
    fileName: "RE-korrigiert.pdf",
    fileSize: 4,
    mimeType: "application/pdf",
    fileContent: Buffer.from("%PDF").toString("base64"),
  };

  it("rechnet das Wartet-Signal des Deals neu", async () => {
    await createDealDocument({ ...base, documentType: "invoice" });
    expect(mocks.aktualisiereWartet).toHaveBeenCalledWith("ws_kottke_prod", "deal_1");
  });

  it("speichert das Dokument auch, wenn das Wartet-Signal scheitert", async () => {
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.aktualisiereWartet.mockRejectedValue(new Error("db weg"));
    await expect(createDealDocument({ ...base, documentType: "invoice" })).resolves.toMatchObject({ id: "doc_1" });
    expect(fehler).toHaveBeenCalled();
    fehler.mockRestore();
  });

  it("does not notify when notifyCustomer is false", async () => {
    await createDealDocument({ ...base, documentType: "invoice", notifyCustomer: false });
    expect(mocks.maybeNotifyPortalEvent).not.toHaveBeenCalled();
  });

  it("notifies invoice_ready and ab_ready when the flag is omitted", async () => {
    await createDealDocument({ ...base, documentType: "invoice" });
    expect(mocks.maybeNotifyPortalEvent).toHaveBeenCalledWith("invoice_ready", {
      workspaceId: "ws_kottke_prod",
      dealRecordId: "deal_1",
    });

    mocks.maybeNotifyPortalEvent.mockClear();
    await createDealDocument({ ...base, documentType: "order_confirmation" });
    expect(mocks.maybeNotifyPortalEvent).toHaveBeenCalledWith("ab_ready", {
      workspaceId: "ws_kottke_prod",
      dealRecordId: "deal_1",
    });
  });

  it("does not notify for a quotation even when the flag is true", async () => {
    await createDealDocument({
      ...base,
      documentType: "quotation",
      notifyCustomer: true,
    });
    expect(mocks.maybeNotifyPortalEvent).not.toHaveBeenCalled();
  });
});

describe("createDealDocument verknüpft den KV mit der Kalkulationsversion", () => {
  const base = {
    workspaceId: "ws_1",
    dealRecordId: "deal_1",
    fileName: "KV-CE-20261106-WEB.pdf",
    fileSize: 4,
    mimeType: "application/pdf",
    fileContent: Buffer.from("%PDF").toString("base64"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertReturning.mockResolvedValue([{ id: "doc_1" }]);
    mocks.maybeNotifyPortalEvent.mockResolvedValue(undefined);
    mocks.aktualisiereWartet.mockResolvedValue(undefined);
    mocks.selectLimit.mockResolvedValue([{ calculationVersionId: "ver_2" }]);
  });

  it("Typ quotation ohne Angabe → null, ohne die Quotation nachzuschlagen (Review 4: bis zum Speichern kann eine andere Version gesperrt sein)", async () => {
    await createDealDocument({ ...base, documentType: "quotation" });
    expect(mocks.insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ calculationVersionId: null }));
    expect(mocks.selectFrom).not.toHaveBeenCalledWith(quotations);
    expect(mocks.selectLimit).not.toHaveBeenCalled();
  });

  it("explizite Angabe des Renderers gilt ohne Abfrage, auch explizit null", async () => {
    await createDealDocument({ ...base, documentType: "quotation", calculationVersionId: "ver_9" });
    expect(mocks.insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ calculationVersionId: "ver_9" }));
    await createDealDocument({ ...base, documentType: "quotation", calculationVersionId: null });
    expect(mocks.insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ calculationVersionId: null }));
    expect(mocks.selectLimit).not.toHaveBeenCalled();
  });

  it("andere Typen bleiben ohne Version, auch mit Angabe", async () => {
    await createDealDocument({ ...base, fileName: "AB-1.pdf", documentType: "order_confirmation", calculationVersionId: "ver_9" });
    expect(mocks.insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ calculationVersionId: null }));
  });

  it("Typ invoice → null, keine Abfrage", async () => {
    await createDealDocument({ ...base, fileName: "RE-1.pdf", documentType: "invoice" });
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ calculationVersionId: null }));
    expect(mocks.selectLimit).not.toHaveBeenCalled();
  });
});

describe("createDealDocument prüft den Workspace", () => {
  const base = {
    workspaceId: "ws_kottke_prod",
    dealRecordId: "deal_fremd",
    fileName: "KV-1.pdf",
    fileSize: 4,
    mimeType: "application/pdf",
    fileContent: Buffer.from("%PDF").toString("base64"),
    documentType: "quotation" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dealImWorkspace.mockResolvedValue(true);
    mocks.insertReturning.mockResolvedValue([{ id: "doc_1", documentType: "quotation", fileName: "KV-1.pdf", fileSize: 4, mimeType: "application/pdf", uploadedAt: new Date() }]);
    mocks.aktualisiereWartet.mockResolvedValue(undefined);
  });

  it("lehnt einen Deal aus einem anderen Workspace ab und legt nichts ab", async () => {
    mocks.dealImWorkspace.mockResolvedValueOnce(false);
    await expect(createDealDocument(base)).rejects.toThrow("Deal nicht gefunden.");
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_kottke_prod", "deal_fremd");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
