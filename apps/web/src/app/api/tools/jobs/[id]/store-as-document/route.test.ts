import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_DEAL_DOCUMENT_SIZE } from "@/services/deal-documents";

// Production 413: store-as-document used to fetch the VPS PDF and then POST
// that file as multipart to /api/v1/deals/:id/documents. The second hop is an
// inbound Vercel request, so anything ≳4.5 MB (typical KV PDFs) died with
// HTTP 413 and `{ error: "upload failed", upstream: {} }` — the platform
// body, not our 10 MB app cap. The handler must insert via createDealDocument
// and must not re-upload the PDF through fetch.

const mocks = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  return {
    getAuthContext: vi.fn(),
    createDealDocument: vi.fn(),
  };
});

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
const JOB_ID = "dfd1e716510e4adb";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

const fetchMock = vi.fn();

function callStore(body: Record<string, unknown> = { dealRecordId: DEAL_ID }) {
  return POST(
    new NextRequest(`https://crm.test/api/tools/jobs/${JOB_ID}/store-as-document`, {
      method: "POST",
      headers: {
        authorization: "Bearer oc_sk_test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: JOB_ID }) }
  );
}

function vpsPdfResponse(bytes: Buffer, filename: string) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.createDealDocument.mockResolvedValue({
    id: "doc_1",
    documentType: "quotation",
    fileName: "KV-KO-20260907-FLO-2.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    uploadedAt: new Date("2026-09-07T10:00:00.000Z"),
  });
});

describe("POST /api/tools/jobs/[id]/store-as-document", () => {
  it("stores a PDF larger than the Vercel 4.5 MB hop without re-uploading it", async () => {
    // 4.6 MB — over the platform inbound body limit, under our 10 MB cap.
    const pdf = Buffer.alloc(Math.ceil(4.6 * 1024 * 1024), 0x25);
    fetchMock.mockResolvedValueOnce(
      vpsPdfResponse(pdf, "KV-KO-20260907-FLO-2.pdf")
    );

    const res = await callStore();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.filename).toBe("KV-KO-20260907-FLO-2.pdf");
    expect(body.deducedDocumentType).toBe("quotation");
    expect(body.document.data.id).toBe("doc_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://crm-tools.test/jobs/${JOB_ID}/result`
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/documents");

    expect(mocks.createDealDocument).toHaveBeenCalledTimes(1);
    expect(mocks.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        dealRecordId: DEAL_ID,
        documentType: "quotation",
        fileName: "KV-KO-20260907-FLO-2.pdf",
        fileSize: pdf.length,
        mimeType: "application/pdf",
      })
    );
    const stored = mocks.createDealDocument.mock.calls[0][0];
    expect(stored.fileContent).toBe(pdf.toString("base64"));
  });

  it("returns the application 413 (not upload failed) when the PDF exceeds 10 MB", async () => {
    const pdf = Buffer.alloc(MAX_DEAL_DOCUMENT_SIZE + 1, 0x25);
    fetchMock.mockResolvedValueOnce(vpsPdfResponse(pdf, "KV-KO-huge.pdf"));

    const res = await callStore();
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body).toEqual({ error: "File too large (max 10 MB)" });
    expect(body.error).not.toBe("upload failed");
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes through an explicit documentType and does not hop the PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7\n", "binary");
    fetchMock.mockResolvedValueOnce(vpsPdfResponse(pdf, "custom.pdf"));

    const res = await callStore({
      dealRecordId: DEAL_ID,
      documentType: "quotation",
    });

    expect(res.status).toBe(200);
    expect(mocks.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "quotation", fileName: "custom.pdf" })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
