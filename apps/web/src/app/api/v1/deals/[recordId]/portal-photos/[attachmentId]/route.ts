import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound } from "@/lib/api-utils";
import { db } from "@/db";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { dealSurfacePhotoMessageMatch, findDealInternalPhoto } from "@/services/deal-photos";
import { and, eq, like } from "drizzle-orm";

/**
 * Streams one portal photo of the deal for the curation UI.
 * Allows inbound customer images, operator portal-uploads, and internal agent photos.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; attachmentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId, attachmentId } = await params;

  const [att] = await db
    .select({
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileContent: inboxMessageAttachments.fileContent,
    })
    .from(inboxMessageAttachments)
    .innerJoin(inboxMessages, eq(inboxMessages.id, inboxMessageAttachments.messageId))
    .where(
      and(
        eq(inboxMessageAttachments.id, attachmentId),
        eq(inboxMessageAttachments.workspaceId, ctx.workspaceId),
        eq(inboxMessageAttachments.dealRecordId, recordId),
        like(inboxMessageAttachments.mimeType, "image/%"),
        dealSurfacePhotoMessageMatch()
      )
    )
    .limit(1);
  const internal = att
    ? null
    : await findDealInternalPhoto(ctx.workspaceId, attachmentId, { dealRecordId: recordId });
  const photo = att ?? internal;
  if (!photo) return notFound();

  const bytes = Buffer.from(photo.fileContent, "base64");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Disposition": `inline; filename="${photo.fileName.replace(/[\\"]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
