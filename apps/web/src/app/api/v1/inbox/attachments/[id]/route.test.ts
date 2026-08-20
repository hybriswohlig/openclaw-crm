import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_JSON_INLINE_BYTES, base64ByteLength } from "@/lib/attachment-content";

// Coverage for the JSON attachment route added to fix the "agent can list
// attachments but never see the picture" bug:
//   - /content streamed raw binary, so the JSON-only MCP client died with
//     INVALID_JSON and got no bytes at all;
//   - /attachments/{id} had NO GET handler, so it fell through to the Next app
//     shell and answered an agent with HTML at status 404.
// Everything below therefore asserts on real HTTP statuses and real parsed JSON
// bodies rather than on the handler's return value shape.
//
// `getAuthContext` is the only thing stubbed out of @/lib/api-utils —
// importOriginal keeps the REAL unauthorized()/notFound()/success(), so the
// status codes and envelopes under test are the ones production ships.
// `@/services/inbox` is the DB seam; we mock the service, not @/db, so the
// route's argument passing (workspace scoping, dealRecordId) stays observable.
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

// Imported after the mock declarations for readability; vitest hoists vi.mock
// above every import anyway, which is why the fns live in vi.hoisted().
import { GET } from "./route";

/** A tiny but genuine JPEG header — ff d8 ff is the magic number. */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  0xff, 0xd9,
]);
const JPEG_BASE64 = JPEG.toString("base64");

const PDF = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary");
const PDF_BASE64 = PDF.toString("base64");

/**
 * A base64 string that decodes to exactly `byteLength` bytes.
 *
 * The route sizes a payload with `base64ByteLength`, which reads only `.length`
 * and the trailing '=' — so a synthetic run of 'A' stands in for megabytes of
 * real image data at roughly zero cost. Sizes are derived from the imported
 * constant so the boundary tests cannot rot if the ceiling is re-tuned.
 */
function base64OfExactly(byteLength: number): string {
  const padding = (3 - (byteLength % 3)) % 3;
  const chars = ((byteLength + padding) / 3) * 4;
  return "A".repeat(chars - padding) + "=".repeat(padding);
}

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

/**
 * NextRequest (not a bare Request): the handler reads
 * `req.nextUrl.searchParams`, which only NextRequest exposes.
 */
function callGet(url = "https://crm.test/api/v1/inbox/attachments/abc", id = "abc") {
  return GET(new NextRequest(url), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.getAttachmentWithContent.mockResolvedValue(attachmentRow());
});

describe("GET /api/v1/inbox/attachments/[id]", () => {
  it("returns 200 with the stored base64 for an authed request", async () => {
    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe("att_abc");
    expect(body.data.fileName).toBe("kueche.jpg");
    expect(body.data.mimeType).toBe("image/jpeg");
    expect(body.data.isImage).toBe(true);
    expect(body.data.contentBase64).toBe(JPEG_BASE64);
  });

  it("hands back real JPEG bytes, not an HTML app shell", async () => {
    // The exact regression: an agent following the attachment URL used to
    // receive the Next.js app shell. Decoding the payload has to produce a file
    // that starts with the JPEG magic number, byte-identical to what was stored.
    const res = await callGet();
    const body = await res.json();

    const decoded = Buffer.from(body.data.contentBase64, "base64");
    expect(decoded.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(decoded.equals(JPEG)).toBe(true);
  });

  it("returns 401 UNAUTHORIZED and never touches the DB without a session", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // Customer photos must not be readable by an unauthenticated caller, and
    // the auth check has to short-circuit BEFORE any row is loaded.
    expect(mocks.getAttachmentWithContent).not.toHaveBeenCalled();
  });

  it("returns a JSON 404 for an unknown id", async () => {
    mocks.getAttachmentWithContent.mockResolvedValue(null);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    // Pinning the content type explicitly: before the handler existed, a
    // near-miss URL produced status 404 with an HTML body, which is what made
    // the MCP client report INVALID_JSON instead of "not found".
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("scopes the lookup to the caller's workspace verbatim", async () => {
    await callGet("https://crm.test/api/v1/inbox/attachments/att_abc", "att_abc");

    expect(mocks.getAttachmentWithContent).toHaveBeenCalledWith(
      "att_abc",
      WORKSPACE_ID,
      { dealRecordId: undefined }
    );
  });

  it("answers a foreign-workspace id exactly like an unknown id", async () => {
    // The service returns null because of the workspace predicate. The response
    // must be indistinguishable from "no such attachment" — otherwise the 404 vs
    // 403 split leaks the existence of another workspace's row.
    mocks.getAttachmentWithContent.mockResolvedValue(null);

    const foreign = await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_other_ws",
      "att_other_ws"
    );
    const foreignBody = await foreign.json();

    mocks.getAttachmentWithContent.mockResolvedValue(null);
    const unknown = await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_nope",
      "att_nope"
    );
    const unknownBody = await unknown.json();

    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(unknown.status);
    expect(foreignBody).toEqual(unknownBody);
    expect(foreign.headers.get("content-type")).toBe(
      unknown.headers.get("content-type")
    );
  });

  it("forwards ?dealRecordId to the service", async () => {
    // Lets an agent assert "this photo really is on that deal" instead of
    // trusting an id it copied out of a message body.
    await callGet(
      "https://crm.test/api/v1/inbox/attachments/att_abc?dealRecordId=deal_42",
      "att_abc"
    );

    expect(mocks.getAttachmentWithContent).toHaveBeenCalledWith(
      "att_abc",
      WORKSPACE_ID,
      { dealRecordId: "deal_42" }
    );
  });

  it("passes dealRecordId: undefined when the query param is absent", async () => {
    await callGet();

    expect(mocks.getAttachmentWithContent).toHaveBeenCalledWith("abc", WORKSPACE_ID, {
      dealRecordId: undefined,
    });
  });

  it("still returns 200 with base64 for a non-image row, flagged isImage:false", async () => {
    // Non-renderable types are not an error: the agent gets the bytes, it just
    // must not be told to build an image content block out of a PDF.
    mocks.getAttachmentWithContent.mockResolvedValue(
      attachmentRow({
        fileName: "angebot.pdf",
        mimeType: "application/pdf",
        fileSize: PDF.length,
        fileContent: PDF_BASE64,
      })
    );

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.mimeType).toBe("application/pdf");
    expect(body.data.isImage).toBe(false);
    expect(body.data.contentBase64).toBe(PDF_BASE64);
    expect(Buffer.from(body.data.contentBase64, "base64").subarray(0, 5).toString()).toBe(
      "%PDF-"
    );
  });

  it("refuses an over-size attachment with a JSON 413, not a platform HTML page", async () => {
    // NextResponse.json buffers the whole body and base64 inflates it by 4/3,
    // so a big file blows the platform's non-streaming response cap. The cap is
    // enforced with an HTML error page, which CrmClient can only report as
    // "this path has no route handler" — telling an agent the endpoint does not
    // exist when it merely overflowed. Fail honestly, in JSON, instead.
    const oversized = base64OfExactly(MAX_JSON_INLINE_BYTES + 1);
    expect(base64ByteLength(oversized)).toBe(MAX_JSON_INLINE_BYTES + 1);

    mocks.getAttachmentWithContent.mockResolvedValue(
      attachmentRow({
        fileName: "umzug-video.mp4",
        mimeType: "video/mp4",
        fileSize: MAX_JSON_INLINE_BYTES + 1,
        fileContent: oversized,
      })
    );

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.error.code).toBe("ATTACHMENT_TOO_LARGE");
    expect(res.headers.get("content-type")).toContain("application/json");
    // The error has to be actionable: name the route that can serve the bytes.
    expect(body.error.message).toContain("/content");
    expect(body.error.message).toContain("umzug-video.mp4");

    // And it must not carry the payload it just refused — neither under the
    // documented key nor smuggled in under any other one.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("contentBase64");
    expect(raw).not.toContain("AAAA");
    expect(raw.length).toBeLessThan(1000);
  });

  it("still returns 200 for an attachment exactly at the ceiling", async () => {
    // Off-by-one guard: the gate is `> MAX`, so the limit itself must pass.
    const atLimit = base64OfExactly(MAX_JSON_INLINE_BYTES);
    expect(base64ByteLength(atLimit)).toBe(MAX_JSON_INLINE_BYTES);

    mocks.getAttachmentWithContent.mockResolvedValue(
      attachmentRow({ fileSize: MAX_JSON_INLINE_BYTES, fileContent: atLimit })
    );

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.contentBase64).toBe(atLimit);
    expect(base64ByteLength(body.data.contentBase64)).toBe(MAX_JSON_INLINE_BYTES);
  });

  it("rejects a present-but-empty ?dealRecordId with 400 and no DB read", async () => {
    // `?dealRecordId=` used to silently drop the "belongs to this deal"
    // conjunct, so the route answered 200 with bytes for an assertion that
    // never ran — the worst possible outcome for an agent verifying provenance.
    const res = await callGet(
      "https://crm.test/api/v1/inbox/attachments/abc?dealRecordId=",
      "abc"
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(mocks.getAttachmentWithContent).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only ?dealRecordId with 400 and no DB read", async () => {
    const res = await callGet(
      "https://crm.test/api/v1/inbox/attachments/abc?dealRecordId=%20",
      "abc"
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(mocks.getAttachmentWithContent).not.toHaveBeenCalled();
  });

  it("lets a non-empty ?dealRecordId through to the service untouched", async () => {
    await callGet(
      "https://crm.test/api/v1/inbox/attachments/abc?dealRecordId=rec_x",
      "abc"
    );

    expect(mocks.getAttachmentWithContent).toHaveBeenCalledWith("abc", WORKSPACE_ID, {
      dealRecordId: "rec_x",
    });
  });
});
