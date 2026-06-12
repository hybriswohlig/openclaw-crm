import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema/activity";
import { emitEvent } from "@/services/activity-events";
import { eq, and, desc, inArray, like } from "drizzle-orm";

/**
 * Curation of the customer's own photos for the portal. The deal's inbound
 * image attachments are the candidate pool; the newest
 * 'deal.portal_photos_curated' activity event holds the valid selection.
 * Re-curating writes a fresh event, so history stays on the timeline.
 */

function invalidInput() {
  return NextResponse.json(
    { error: { code: "INVALID_INPUT" } },
    { status: 400 }
  );
}

/** All inbound image attachments of the deal, scoped to the workspace. */
async function loadInboundImageAttachments(workspaceId: string, recordId: string) {
  return db
    .select({
      id: inboxMessageAttachments.id,
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileSize: inboxMessageAttachments.fileSize,
      createdAt: inboxMessageAttachments.createdAt,
    })
    .from(inboxMessageAttachments)
    .innerJoin(inboxMessages, eq(inboxMessages.id, inboxMessageAttachments.messageId))
    .where(
      and(
        eq(inboxMessageAttachments.workspaceId, workspaceId),
        eq(inboxMessageAttachments.dealRecordId, recordId),
        eq(inboxMessages.direction, "inbound"),
        like(inboxMessageAttachments.mimeType, "image/%")
      )
    )
    .orderBy(desc(inboxMessageAttachments.createdAt));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  const rows = await loadInboundImageAttachments(ctx.workspaceId, recordId);

  // Newest curation event wins; older events are history only.
  const [event] = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ctx.workspaceId),
        eq(activityEvents.recordId, recordId),
        eq(activityEvents.eventType, "deal.portal_photos_curated")
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);
  const rawIds = (event?.payload as Record<string, unknown> | undefined)?.attachmentIds;
  const selected = new Set(
    Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string") : []
  );

  return success({
    photos: rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      createdAt: r.createdAt.toISOString(),
      selected: selected.has(r.id),
    })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidInput();
  }

  const rawIds = (body as Record<string, unknown> | null)?.attachmentIds;
  if (
    !Array.isArray(rawIds) ||
    !rawIds.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    return invalidInput();
  }
  const attachmentIds = rawIds;

  // Every id must be an inbound image attachment of this deal. An empty
  // array is allowed and clears the selection.
  if (attachmentIds.length > 0) {
    const valid = await db
      .select({ id: inboxMessageAttachments.id })
      .from(inboxMessageAttachments)
      .innerJoin(inboxMessages, eq(inboxMessages.id, inboxMessageAttachments.messageId))
      .where(
        and(
          inArray(inboxMessageAttachments.id, attachmentIds),
          eq(inboxMessageAttachments.workspaceId, ctx.workspaceId),
          eq(inboxMessageAttachments.dealRecordId, recordId),
          eq(inboxMessages.direction, "inbound"),
          like(inboxMessageAttachments.mimeType, "image/%")
        )
      );
    const validIds = new Set(valid.map((v) => v.id));
    if (!attachmentIds.every((id) => validIds.has(id))) {
      return invalidInput();
    }
  }

  await emitEvent({
    workspaceId: ctx.workspaceId,
    recordId,
    objectSlug: "deals",
    eventType: "deal.portal_photos_curated",
    payload: { attachmentIds },
    actorId: ctx.userId,
  });

  return success({ ok: true });
}
