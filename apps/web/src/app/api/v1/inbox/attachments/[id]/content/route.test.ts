import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Coverage for the binary stream the inbox <img> hits.
//
// crm_get_attachment reads the JSON twin at ../[id]; this file exists so that
// path stays a raw JPEG for the browser while agents still get a JSON 404
// (never the Next.js HTML shell) when the id is missing or belongs to another
// workspace.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getAttachmentWithContent: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/inbox", () => ({
  getAttachmentWithContent: mocks.getAttachmentWithContent,
}));

import { GET } from "./route";

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  0xff, 0xd9,
]);
const JPEG_BASE64 = JPEG.toString("base64");

const WORKSPACE_ID = "ws_kottke_prod";

const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "att_abc",
    fileName: "kueche.jpg",
    mimeType: "image/jpeg",
    fileSize: JPEG.length,
    fileContent: JPEG_BASE64,
    transcript: null,
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    conversationId: "conv_1",
    messageId: "msg_1",
    dealRecordId: "deal_1",
    ...overrides,
  };
}

function callGet(
  url = "https://crm.test/api/v1/inbox/attachments/att_abc/content",
  id = "att_abc"
) {
  return GET(new NextRequest(url), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.getAttachmentWithContent.mockResolvedValue(attachmentRow());
});

describe("GET /api/v1/inbox/attachments/[id]/content", () => {
  it("streams the stored JPEG bytes for an authed request (inbox <img> path)", async () => {
    const res = await callGet();
    const body = Buffer.from(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-length")).toBe(String(JPEG.length));
    expect(body.equals(JPEG)).toBe(true);
    expect(body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(mocks.getAttachmentWithContent).toHaveBeenCalledWith("att_abc", WORKSPACE_ID);
  });

  it("does not wrap the default /content body as JSON", async () => {
    // A Content-Type of image/jpeg is what keeps <img src=…> working. If this
    // ever became application/json the inbox thumbnails would break.
    const res = await callGet();
    const text = await res.text();

    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(text.startsWith("{")).toBe(false);
    expect(text).not.toContain("contentBase64");
  });

  it("returns 200 JSON with the specified fields when ?format=json", async () => {
    const res = await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_abc/content?format=json",
      "att_abc"
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(body.data).toMatchObject({
      id: "att_abc",
      fileName: "kueche.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
      contentBase64: JPEG_BASE64,
      conversationId: "conv_1",
      messageId: "msg_1",
    });
  });

  it("returns 401 UNAUTHORIZED and never touches the DB without a session", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mocks.getAttachmentWithContent).not.toHaveBeenCalled();
  });

  it("returns JSON { error: \"Not found\" } for an unknown id", async () => {
    mocks.getAttachmentWithContent.mockResolvedValue(null);

    const res = await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_nope/content",
      "att_nope"
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("answers a foreign-workspace id exactly like an unknown id", async () => {
    mocks.getAttachmentWithContent.mockResolvedValue(null);

    const foreign = await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_other_ws/content",
      "att_other_ws"
    );
    const foreignBody = await foreign.json();

    const unknown = await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_nope/content",
      "att_nope"
    );
    const unknownBody = await unknown.json();

    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(unknown.status);
    expect(foreignBody).toEqual({ error: "Not found" });
    expect(foreignBody).toEqual(unknownBody);
    expect(foreign.headers.get("content-type")).toBe(
      unknown.headers.get("content-type")
    );
  });
});
