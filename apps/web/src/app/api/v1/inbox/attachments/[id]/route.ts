import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getAttachmentWithContent } from "@/services/inbox";
import {
  base64ByteLength,
  MAX_JSON_INLINE_BYTES,
  normaliseBase64,
  toAttachmentPayload,
} from "@/lib/attachment-content";

export const dynamic = "force-dynamic";

/**
 * JSON twin of `[id]/content`: same bytes, base64 in a JSON envelope.
 *
 * `/content` streams raw binary because the inbox renders it straight into an
 * `<img>`. Every JSON-only consumer — the MCP tools, and any agent reaching for
 * the `crm_api` escape hatch — choked on that: the response is a JPEG, the
 * client parses JSON, and the failure surfaced as INVALID_JSON with no bytes.
 * Worse, this path had no GET handler at all, so a near-miss URL fell through
 * to the Next app shell and returned HTML with status 404 instead of an error
 * an agent could act on.
 *
 * Auth is mandatory and the row is workspace-scoped, exactly like `/content`.
 *
 * 200 { data: { id, fileName, mimeType, fileSize, contentBase64, isImage, … } }
 * 400 { error: { code: "BAD_REQUEST" } }        — dealRecordId present but empty
 * 401 { error: { code: "UNAUTHORIZED" } }
 * 404 { error: { code: "NOT_FOUND" } }          — also for another workspace's id
 * 413 { error: { code: "ATTACHMENT_TOO_LARGE" } }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;

  // Optional extra scoping so an agent can assert "this photo is on that deal".
  // A present-but-empty value is a caller bug, not "no filter" — silently
  // dropping the conjunct would answer 200 to an assertion that never ran.
  const rawDeal = req.nextUrl.searchParams.get("dealRecordId")?.trim();
  if (rawDeal === "") {
    return badRequest("dealRecordId must be a non-empty id when present");
  }

  const row = await getAttachmentWithContent(id, ctx.workspaceId, {
    dealRecordId: rawDeal,
  });
  if (!row) return notFound();

  // A buffered JSON body cannot carry an arbitrarily large file: base64 adds
  // 4/3 and the platform caps non-streaming responses. Say so with real JSON
  // rather than letting the runtime answer with an HTML error page, which a
  // JSON client can only read as "this route does not exist".
  const byteLength = base64ByteLength(normaliseBase64(row.fileContent));
  if (byteLength > MAX_JSON_INLINE_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "ATTACHMENT_TOO_LARGE",
          message:
            `${row.fileName} is ${byteLength} bytes, over the ` +
            `${MAX_JSON_INLINE_BYTES}-byte limit for a JSON response. Stream it ` +
            `from /api/v1/inbox/attachments/${row.id}/content instead.`,
        },
      },
      { status: 413 }
    );
  }

  return success(toAttachmentPayload(row));
}
