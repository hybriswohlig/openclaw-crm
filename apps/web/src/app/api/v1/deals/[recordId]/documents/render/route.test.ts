import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  storeCommercialDocument: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/commercial-documents", () => ({
  storeCommercialDocument: mocks.storeCommercialDocument,
  CommercialDocumentError: class CommercialDocumentError extends Error {
    status: number;
    code: string;
    constructor(message: string, status: number, code = "BAD_REQUEST") {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { POST } from "./route";

const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

function call(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/documents/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer oc_sk_test" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: DEAL_ID }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: "ws_kottke_prod",
    workspaceRole: "admin",
    permissions: {},
  });
  mocks.storeCommercialDocument.mockResolvedValue({
    templateVersion: "kv-ab-re/1",
    fileName: "KV-kottke-2026-10-16-abcd1234.pdf",
    document: { id: "doc_1", documentType: "quotation" },
  });
});

describe("POST documents/render", () => {
  it("does not render when renderer is omitted", async () => {
    const res = await call({ documentType: "KV", copy: { intro: "Hallo" } });
    expect(res.status).toBe(409);
    expect(mocks.storeCommercialDocument).not.toHaveBeenCalled();
  });

  it("stores with the CRM renderer and does not notify unless asked", async () => {
    const res = await call({
      renderer: "crm",
      documentType: "AB",
      document_copy: { closing: "Viele Grüße" },
      notes: "INTERN-NOTIZ-GEHEIM-4711",
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.renderer).toBe("crm");
    expect(body.data.templateVersion).toBe("kv-ab-re/1");
    expect(mocks.storeCommercialDocument).toHaveBeenCalledWith({
      workspaceId: "ws_kottke_prod",
      dealRecordId: DEAL_ID,
      kind: "AB",
      copy: { closing: "Viele Grüße" },
      notifyCustomer: false,
    });
  });
});
