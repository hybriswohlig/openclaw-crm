import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_JSON_INLINE_BYTES } from "@/lib/attachment-content";
import { jsonDealDocumentTooLargeMessage } from "@/lib/deal-document-upload";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createDealDocument: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/deal-documents")>();
  return { ...actual, createDealDocument: mocks.createDealDocument };
});

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
  it("stores a corrected invoice PDF and does not notify the customer", async () => {
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
    expect(mocks.createDealDocument).toHaveBeenCalledTimes(1);
    expect(mocks.createDealDocument).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      dealRecordId: DEAL_ID,
      documentType: "invoice",
      fileName: "RE-korrigiert.pdf",
      fileSize: pdf.length,
      mimeType: "application/pdf",
      fileContent: pdf.toString("base64"),
      notifyCustomer: false,
    });
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

  it("keeps the multipart staff upload on the notifying path", async () => {
    const pdf = Buffer.from("%PDF-1.4\n");
    const form = new FormData();
    form.append("file", new File([pdf], "RE-ui.pdf", { type: "application/pdf" }));
    form.append("documentType", "invoice");

    const res = await POST(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/documents`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );

    expect(res.status).toBe(200);
    const stored = mocks.createDealDocument.mock.calls[0][0];
    expect(stored.documentType).toBe("invoice");
    expect(stored.fileName).toBe("RE-ui.pdf");
    expect(stored.notifyCustomer).toBeUndefined();
  });
});
