import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboxConversations } from "@/db/schema/inbox";
import { getAuthContext } from "@/lib/api-utils";
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
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const ctx = await getAuthContext(req);
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload fehlgeschlagen" },
      { status: 400 }
    );
  }
}
