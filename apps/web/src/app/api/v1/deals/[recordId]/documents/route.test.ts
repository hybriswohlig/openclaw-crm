import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_JSON_INLINE_BYTES } from "@/lib/attachment-content";
import { jsonDealDocumentTooLargeMessage } from "@/lib/deal-document-upload";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createDealDocument: vi.fn(),
  applyInvoiceDueDate: vi.fn(),
  rechnungHochladen: vi.fn(),
}));

vi.mock("@/services/rechnungen", () => ({ rechnungHochladen: mocks.rechnungHochladen }));

const dealImWorkspaceMock = vi.hoisted(() => vi.fn(async (_ws: string, _deal: string) => true));
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>()),
  dealImWorkspace: dealImWorkspaceMock,
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/deal-documents")>();
  return { ...actual, createDealDocument: mocks.createDealDocument };
});

vi.mock("@/services/rechnung-faellig", () => ({
  applyInvoiceDueDate: mocks.applyInvoiceDueDate,
}));

import { POST } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callJson(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/documents`, {
      method: "POST",
      headers: {
        authorization: "Bearer oc_sk_test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: DEAL_ID }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.applyInvoiceDueDate.mockImplementation(async (input: { documentType: string; explicitDueDate?: unknown }) => {
    if (input.documentType !== "invoice") return { rechnungFaelligAm: null };
    return {
      rechnungFaelligAm:
        typeof input.explicitDueDate === "string" && input.explicitDueDate
          ? input.explicitDueDate
          : "2026-11-02",
    };
  });
  mocks.rechnungHochladen.mockImplementation(async (dok: Record<string, unknown>, e: { faelligAm: string | null; bruttoCent: number | null }) => ({
    document: { id: "doc_1", documentType: "invoice", fileName: dok.fileName },
    rechnung: { id: "inv_1", bruttoCent: e.bruttoCent ?? 90000, faelligAm: e.faelligAm ?? "2026-11-02" },
  }));
  mocks.createDealDocument.mockResolvedValue({
    id: "doc_1",
    documentType: "invoice",
    fileName: "RE-korrigiert.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    uploadedAt: new Date("2026-10-14T12:00:00.000Z"),
  });
});

describe("POST /api/v1/deals/[recordId]/documents JSON upload", () => {
  it("Rechnung über den Datensatz: Prüfung, Fälligkeit, kein Kundenversand (Plan 9)", async () => {
    const pdf = Buffer.alloc(47 * 1024, 0x25);
    pdf.write("%PDF-1.4", 0, "utf8");

    const res = await callJson({
      fileName: "RE-korrigiert.pdf",
      documentType: "invoice",
      contentBase64: pdf.toString("base64"),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe("doc_1");
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
    expect(mocks.rechnungHochladen).toHaveBeenCalledWith(
      {
        workspaceId: WORKSPACE_ID,
        dealRecordId: DEAL_ID,
        documentType: "invoice",
        fileName: "RE-korrigiert.pdf",
        fileSize: pdf.length,
        mimeType: "application/pdf",
        fileContent: pdf.toString("base64"),
        notifyCustomer: false,
      },
      { bruttoCent: null, abweichungGrund: null, faelligAm: null, durchAgent: true, userId: AUTH_CTX.userId }
    );
    expect(body.rechnungFaelligAm).toBe("2026-11-02");
    expect(mocks.applyInvoiceDueDate).not.toHaveBeenCalled();
  });

  it("Rechnung mit Betrag, Grund und ausdrücklicher Fälligkeit", async () => {
    const res = await callJson({
      fileName: "RE-korrigiert.pdf",
      documentType: "invoice",
      contentBase64: Buffer.from("%PDF-1.4\n").toString("base64"),
      dueDate: "01.12.2026",
      bruttoCent: 95000,
      abweichungGrund: "Eine Stunde mehr vor Ort",
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rechnungFaelligAm).toBe("2026-12-01");
    expect(mocks.rechnungHochladen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bruttoCent: 95000, abweichungGrund: "Eine Stunde mehr vor Ort", faelligAm: "2026-12-01" })
    );
  });

  it("Prüfung scheitert: 409 mit Code; ungültiger Betrag 400", async () => {
    const { GeldFehler } = await import("@/lib/geld");
    mocks.rechnungHochladen.mockRejectedValueOnce(new GeldFehler("STUNDEN_BETRAG_FEHLT"));
    const base = { fileName: "RE.pdf", documentType: "invoice", contentBase64: Buffer.from("%PDF-1.4\n").toString("base64") };
    const res = await callJson(base);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STUNDEN_BETRAG_FEHLT");
    const falsch = await callJson({ ...base, bruttoCent: -5 });
    expect(falsch.status).toBe(400);
  });

  it("opts in to the portal notifier only when notifyCustomer is true", async () => {
    const pdf = Buffer.from("%PDF-1.4\n");
    await callJson({
      fileName: "AB.pdf",
      documentType: "order_confirmation",
      mimeType: "application/pdf",
      contentBase64: pdf.toString("base64"),
      notifyCustomer: true,
    });
    expect(mocks.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "order_confirmation", notifyCustomer: true })
    );
    expect(mocks.applyInvoiceDueDate).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "order_confirmation" })
    );
  });

  it("returns 413 above the JSON cap so the body stays under Vercel's ~4.5 MB limit", async () => {
    const pdf = Buffer.alloc(MAX_JSON_INLINE_BYTES + 1, 0x25);
    const res = await callJson({
      fileName: "zu-gross.pdf",
      documentType: "invoice",
      contentBase64: pdf.toString("base64"),
    });
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body).toEqual({ error: jsonDealDocumentTooLargeMessage() });
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });

  it("rejects a bad documentType", async () => {
    const res = await callJson({
      fileName: "x.pdf",
      documentType: "not-a-type",
      contentBase64: Buffer.from("%PDF-1.4\n").toString("base64"),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Invalid documentType" });
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });

  it("Multipart-Upload einer Rechnung (alte Oberfläche) läuft über den Datensatz, als Mensch", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...AUTH_CTX, authMethod: "cookie" });
    const pdf = Buffer.from("%PDF-1.4\n");
    const form = new FormData();
    form.append("file", new File([pdf], "RE-ui.pdf", { type: "application/pdf" }));
    form.append("documentType", "invoice");
    form.append("dueDate", "2026-12-20");

    const res = await POST(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/documents`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );

    expect(res.status).toBe(200);
    const [stored, e] = mocks.rechnungHochladen.mock.calls[0];
    expect(stored.documentType).toBe("invoice");
    expect(stored.fileName).toBe("RE-ui.pdf");
    expect(stored.notifyCustomer).toBeUndefined();
    expect(e).toMatchObject({ faelligAm: "2026-12-20", durchAgent: false });
  });
});

describe("POST /api/v1/deals/[recordId]/documents fremder Deal (Plan 5a)", () => {
  it("antwortet 404 und legt nichts ab", async () => {
    dealImWorkspaceMock.mockResolvedValueOnce(false);
    const req = new NextRequest("https://crm.test/api/v1/deals/fremd/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "RE-1.pdf", documentType: "invoice", fileContent: "JVBERi0=" }),
    });
    const res = await POST(req, { params: Promise.resolve({ recordId: "fremd" }) });
    expect(res.status).toBe(404);
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });
});
