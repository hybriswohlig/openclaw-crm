import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  previewCommercialDocument: vi.fn(),
  dealBlocksInRepoCrmRenderer: vi.fn(async () => false),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/lib/kottke-crm-renderer-deal", () => ({
  dealBlocksInRepoCrmRenderer: mocks.dealBlocksInRepoCrmRenderer,
}));

vi.mock("@/services/commercial-documents", () => ({
  previewCommercialDocument: mocks.previewCommercialDocument,
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

import { KOTTKE_CRM_RENDERER_MESSAGE } from "@/lib/kottke-crm-renderer";
import { GET, POST } from "./route";

const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/documents/preview`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer oc_sk_test" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: DEAL_ID }) }
  );
}

function get(documentType: string) {
  return GET(
    new NextRequest(
      `https://crm.test/api/v1/deals/${DEAL_ID}/documents/preview?documentType=${documentType}&format=json`,
      { headers: { authorization: "Bearer oc_sk_test" } }
    ),
    { params: Promise.resolve({ recordId: DEAL_ID }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dealBlocksInRepoCrmRenderer.mockResolvedValue(false);
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: "ws_kottke_prod",
    workspaceRole: "admin",
    permissions: {},
  });
  mocks.previewCommercialDocument.mockResolvedValue({
    model: { kind: "KV" },
    html: "<p>Vorschau</p>",
    pdf: new Uint8Array([1]),
    fileName: "KV-ceylan.pdf",
    templateVersion: "kv-ab-re/2",
  });
});

describe("documents/preview Kottke lock", () => {
  it("rejects GET and POST for a Kottke deal", async () => {
    mocks.dealBlocksInRepoCrmRenderer.mockResolvedValue(true);
    for (const documentType of ["KV", "AB", "RE"]) {
      const posted = await post({ documentType, format: "json" });
      const postedBody = await posted.json();
      expect(posted.status).toBe(400);
      expect(postedBody.error.message).toBe(KOTTKE_CRM_RENDERER_MESSAGE);

      const fetched = await get(documentType);
      const fetchedBody = await fetched.json();
      expect(fetched.status).toBe(400);
      expect(fetchedBody.error.message).toBe(KOTTKE_CRM_RENDERER_MESSAGE);
    }
    expect(mocks.previewCommercialDocument).not.toHaveBeenCalled();
  });

  it("still previews for any other company", async () => {
    const res = await post({ documentType: "KV", format: "json" });
    expect(res.status).toBe(200);
    expect(mocks.previewCommercialDocument).toHaveBeenCalledOnce();
  });
});
