import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  loadSignedDocument: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-signature", () => ({
  loadSignedDocument: mocks.loadSignedDocument,
}));

import { GET } from "./route";

const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: "ws_1",
    workspaceRole: "member",
    permissions: {},
    authMethod: "session",
  });
});

describe("GET signed contract PDF", () => {
  it("streams the PDF bytes", async () => {
    const pdf = Buffer.from("%PDF-1.4 signed");
    mocks.loadSignedDocument.mockResolvedValue({
      mimeType: "application/pdf",
      fileName: "Vertrag.pdf",
      fileContent: pdf.toString("base64"),
      confirmationId: "conf_1",
      superseded: false,
    });
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/signature/document?confirmationId=conf_1`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("x-confirmation-id")).toBe("conf_1");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString()).toBe("%PDF-1.4 signed");
    expect(mocks.loadSignedDocument).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: DEAL_ID,
      confirmationId: "conf_1",
    });
  });

  it("returns 404 when nothing is signed", async () => {
    mocks.loadSignedDocument.mockResolvedValue(null);
    const res = await GET(
      new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/signature/document`),
      { params: Promise.resolve({ recordId: DEAL_ID }) }
    );
    expect(res.status).toBe(404);
  });
});
