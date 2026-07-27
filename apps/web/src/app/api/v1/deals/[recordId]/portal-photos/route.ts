import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import {
  inboxConversations,
  inboxMessageAttachments,
  inboxMessages,
} from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema/activity";
import { emitEvent } from "@/services/activity-events";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";

/**
 * Portal photos for a deal.
 *
 * GET  — all inbound customer images + operator portal-uploads, with a
 *        `selected` flag from the newest AI-curation event (selection is
 *        for KI-Zusammenfassung only; the public portal shows every photo).
 * PUT  — persist AI-selection attachment ids (activity event).
 * POST — multipart upload of operator-owned photos for the status portal.
 */

const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB per file
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

function invalidInput(code = "INVALID_INPUT") {
  return NextResponse.json({ error: { code } }, { status: 400 });
}

/** Inbound images + operator portal-uploads linked to the deal. */
async function loadDealPortalPhotos(workspaceId: string, recordId: string) {
  return db
    .select({
      id: inboxMessageAttachments.id,
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileSize: inboxMessageAttachments.fileSize,
      createdAt: inboxMessageAttachments.createdAt,
      direction: inboxMessages.direction,
      externalMessageId: inboxMessages.externalMessageId,
    })
    .from(inboxMessageAttachments)
    .innerJoin(inboxMessages, eq(inboxMessages.id, inboxMessageAttachments.messageId))
    .where(
      and(
        eq(inboxMessageAttachments.workspaceId, workspaceId),
        eq(inboxMessageAttachments.dealRecordId, recordId),
        like(inboxMessageAttachments.mimeType, "image/%"),
        or(
          eq(inboxMessages.direction, "inbound"),
          like(inboxMessages.externalMessageId, "portal-upload:%")
        )
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
  const rows = await loadDealPortalPhotos(ctx.workspaceId, recordId);

  // Newest curation event = AI-selection only (portal display ignores this).
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
      source:
        r.direction === "outbound" || (r.externalMessageId ?? "").startsWith("portal-upload:")
          ? ("operator" as const)
          : ("customer" as const),
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

  // Ids must belong to this deal's portal photo pool (inbound or portal-upload).
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
          like(inboxMessageAttachments.mimeType, "image/%"),
          or(
            eq(inboxMessages.direction, "inbound"),
            like(inboxMessages.externalMessageId, "portal-upload:%")
          )
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

/**
 * Multipart upload: field name `files` (one or more images). Stored as
 * outbound inbox messages tagged portal-upload:* so they appear on the
 * public portal without being sent to the customer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return invalidInput();
  }

  const entries = form.getAll("files").filter((v): v is File => v instanceof File);
  if (entries.length === 0) return invalidInput("NO_FILES");
  if (entries.length > MAX_UPLOAD_FILES) return invalidInput("TOO_MANY_FILES");

  const [conv] = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, ctx.workspaceId),
        eq(inboxConversations.dealRecordId, recordId)
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);
  if (!conv) {
    return NextResponse.json(
      { error: { code: "NO_CONVERSATION", message: "Kein Chat am Lead — Fotos können nicht gespeichert werden." } },
      { status: 400 }
    );
  }

  const uploaded: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    selected: boolean;
    source: "operator";
  }> = [];

  for (const file of entries) {
    const mime = (file.type || "application/octet-stream").toLowerCase();
    if (!ALLOWED_MIME.has(mime) && !mime.startsWith("image/")) {
      return invalidInput("UNSUPPORTED_TYPE");
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return invalidInput("FILE_TOO_LARGE");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = (file.name || "foto.jpg").replace(/[\\/"]/g, "_").slice(0, 180);
    const externalMessageId = `portal-upload:${crypto.randomUUID()}`;

    const [msg] = await db
      .insert(inboxMessages)
      .values({
        workspaceId: ctx.workspaceId,
        conversationId: conv.id,
        direction: "outbound",
        status: "sent",
        externalMessageId,
        body: "Foto für Status-Portal (intern hochgeladen)",
        isRead: true,
        sentAt: new Date(),
      })
      .returning({ id: inboxMessages.id });

    const [att] = await db
      .insert(inboxMessageAttachments)
      .values({
        workspaceId: ctx.workspaceId,
        messageId: msg.id,
        conversationId: conv.id,
        dealRecordId: recordId,
        fileName,
        mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
        fileSize: buffer.length,
        fileContent: buffer.toString("base64"),
        externalMediaId: externalMessageId,
      })
      .returning({
        id: inboxMessageAttachments.id,
        fileName: inboxMessageAttachments.fileName,
        mimeType: inboxMessageAttachments.mimeType,
        fileSize: inboxMessageAttachments.fileSize,
        createdAt: inboxMessageAttachments.createdAt,
      });

    uploaded.push({
      id: att.id,
      fileName: att.fileName,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
      createdAt: att.createdAt.toISOString(),
      selected: false,
      source: "operator",
    });
  }

  return success({ photos: uploaded });
}
