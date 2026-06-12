import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound } from "@/lib/api-utils";
import { db } from "@/db";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { eq, and, like } from "drizzle-orm";

/**
 * Streams one inbound image attachment of the deal for the curation UI.
 * 404s when the attachment does not belong to the deal or is not an
 * inbound image, so nothing else leaks through this route.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; attachmentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

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
        eq(inboxMessages.direction, "inbound"),
        like(inboxMessageAttachments.mimeType, "image/%")
      )
    )
    .limit(1);
  if (!att) return notFound();

  const bytes = Buffer.from(att.fileContent, "base64");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": att.mimeType,
      "Content-Disposition": `inline; filename="${att.fileName.replace(/[\\"]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
