import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboxConversations } from "@/db/schema/inbox";
import { consumeApiKeyScopeDenial, getAuthContext } from "@/lib/api-utils";
import { describeInboxMediaUploadError } from "@/lib/inbox-media-upload-error";
import {
  INBOX_BLOB_MAX_BYTES,
  isInboxMediaBlobPath,
} from "@/lib/inbox-media-upload";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "video/mp4",
  "audio/mpeg",
  "audio/ogg",
  "application/octet-stream",
];

/**
 * Client-upload token for a WhatsApp attachment. The phone sends the bytes
 * straight to Blob so an 8 MB PDF never hits Vercel's 4.5 MB function limit.
 */
function rejectUpload(err: unknown): NextResponse {
  const failure = describeInboxMediaUploadError(err);
  // Message plus the check that failed. The token value is already redacted.
  console.error(`[inbox/media-upload] check=${failure.check} message=${failure.message}`);
  return NextResponse.json({ error: failure.clientMessage }, { status: 400 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not set");
    }
    // The blob handshake reports auth failures as 400. A read-only key must
    // get 403 before a client token is minted. Unauthenticated calls still
    // fail inside onBeforeGenerateToken.
    const pre = await getAuthContext(req);
    if (!pre) {
      const denied = consumeApiKeyScopeDenial(req);
      if (denied) return denied;
    }
    const body = (await req.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const ctx = pre ?? (await getAuthContext(req));
        if (!ctx) throw new Error("Nicht angemeldet.");
        const conversationId = pathname.split("/")[2] ?? "";
        if (!isInboxMediaBlobPath(pathname, conversationId)) {
          throw new Error("Ungültiger Upload-Pfad.");
        }
        const [conv] = await db
          .select({ id: inboxConversations.id })
          .from(inboxConversations)
          .where(
            and(
              eq(inboxConversations.id, conversationId),
              eq(inboxConversations.workspaceId, ctx.workspaceId)
            )
          )
          .limit(1);
        if (!conv) throw new Error("Unterhaltung nicht gefunden.");
        return {
          access: "private",
          addRandomSuffix: true,
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: INBOX_BLOB_MAX_BYTES,
          tokenPayload: JSON.stringify({
            workspaceId: ctx.workspaceId,
            conversationId,
          }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    return rejectUpload(err);
  }
}
