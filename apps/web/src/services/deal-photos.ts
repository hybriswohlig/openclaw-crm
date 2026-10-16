// Store agent-uploaded deal photos next to portal photos, without telling
// the customer. The inbox row exists only because attachments require a
// message; it is not sent, and callers must hide internal-photo:* rows from
// chat, reply-state and the public portal.

import { createHash } from "node:crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { inboxConversations, inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { normaliseBase64 } from "@/lib/attachment-content";
import {
  INTERNAL_PHOTO_PREFIX,
  PORTAL_UPLOAD_PREFIX,
  type PreparedDealPhoto,
} from "@/lib/deal-photo-upload";

/**
 * Not an outbound send. `received` is outside ANTWORT_STATUS, so the row
 * does not clear „wartet auf Antwort“.
 */
export const INTERNAL_PHOTO_MESSAGE_STATUS = "received" as const;

/** SQL predicate: drop storage rows that are not conversation messages. */
export function excludeInternalPhotoMessages() {
  return sql`(${inboxMessages.externalMessageId} is null or ${inboxMessages.externalMessageId} not like ${`${INTERNAL_PHOTO_PREFIX}%`})`;
}

/** Inbound images, portal uploads, and internal agent photos. */
export function dealSurfacePhotoMessageMatch() {
  return sql`(
    ${inboxMessages.direction} = 'inbound'
    or ${inboxMessages.externalMessageId} like ${`${PORTAL_UPLOAD_PREFIX}%`}
    or ${inboxMessages.externalMessageId} like ${`${INTERNAL_PHOTO_PREFIX}%`}
  )`;
}

export interface StoredInternalDealPhoto {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentSha256: string;
  createdAt: string;
  source: "internal";
  customerVisible: false;
  skipped: false;
}

export interface SkippedDuplicateDealPhoto {
  fileName: string;
  contentSha256: string;
  duplicateOf: string;
  skipped: true;
  reason: "duplicate";
}

export type UploadInternalDealPhotosResult =
  | {
      ok: true;
      photos: StoredInternalDealPhoto[];
      skipped: SkippedDuplicateDealPhoto[];
    }
  | { ok: false; status: 400; code: "NO_CONVERSATION"; error: string };

/**
 * Write internal photos onto the deal's newest conversation.
 * Does not notify, does not update the conversation, and does not send.
 * Same content hash as an image already on the deal is skipped.
 */
export async function uploadInternalDealPhotos(input: {
  workspaceId: string;
  dealRecordId: string;
  photos: PreparedDealPhoto[];
}): Promise<UploadInternalDealPhotosResult> {
  const existing = await db
    .select({
      id: inboxMessageAttachments.id,
      fileContent: inboxMessageAttachments.fileContent,
      externalMediaId: inboxMessageAttachments.externalMediaId,
    })
    .from(inboxMessageAttachments)
    .where(
      and(
        eq(inboxMessageAttachments.workspaceId, input.workspaceId),
        eq(inboxMessageAttachments.dealRecordId, input.dealRecordId),
        like(inboxMessageAttachments.mimeType, "image/%")
      )
    );

  const hashes = new Map<string, string>();
  for (const row of existing) {
    const hash = hashOfStoredPhoto(row.fileContent, row.externalMediaId);
    if (hash && !hashes.has(hash)) hashes.set(hash, row.id);
  }

  const skipped: SkippedDuplicateDealPhoto[] = [];
  const toInsert: PreparedDealPhoto[] = [];
  const batchHashes = new Set<string>();
  for (const photo of input.photos) {
    const duplicateOf = hashes.get(photo.contentSha256);
    if (duplicateOf) {
      skipped.push({
        fileName: photo.fileName,
        contentSha256: photo.contentSha256,
        duplicateOf,
        skipped: true,
        reason: "duplicate",
      });
      continue;
    }
    if (batchHashes.has(photo.contentSha256)) {
      // Resolved to the stored id after insert.
      skipped.push({
        fileName: photo.fileName,
        contentSha256: photo.contentSha256,
        duplicateOf: "",
        skipped: true,
        reason: "duplicate",
      });
      continue;
    }
    batchHashes.add(photo.contentSha256);
    toInsert.push(photo);
  }

  if (toInsert.length === 0) {
    return { ok: true, photos: [], skipped };
  }

  const [conv] = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, input.workspaceId),
        eq(inboxConversations.dealRecordId, input.dealRecordId)
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);
  if (!conv) {
    return {
      ok: false,
      status: 400,
      code: "NO_CONVERSATION",
      error: "No conversation on this deal — photos cannot be stored.",
    };
  }

  const stored: StoredInternalDealPhoto[] = [];
  const storedIds = new Map<string, string>();
  await db.transaction(async (tx) => {
    for (const photo of toInsert) {
      const externalMessageId = `${INTERNAL_PHOTO_PREFIX}${crypto.randomUUID()}`;
      const [msg] = await tx
        .insert(inboxMessages)
        .values({
          workspaceId: input.workspaceId,
          conversationId: conv.id,
          direction: "outbound",
          status: INTERNAL_PHOTO_MESSAGE_STATUS,
          externalMessageId,
          body: "",
          isRead: true,
          sentAt: new Date(),
        })
        .returning({ id: inboxMessages.id });

      const [att] = await tx
        .insert(inboxMessageAttachments)
        .values({
          workspaceId: input.workspaceId,
          messageId: msg.id,
          conversationId: conv.id,
          dealRecordId: input.dealRecordId,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
          fileSize: photo.fileSize,
          fileContent: photo.fileContent,
          externalMediaId: `sha256:${photo.contentSha256}`,
        })
        .returning({
          id: inboxMessageAttachments.id,
          fileName: inboxMessageAttachments.fileName,
          mimeType: inboxMessageAttachments.mimeType,
          fileSize: inboxMessageAttachments.fileSize,
          createdAt: inboxMessageAttachments.createdAt,
        });

      storedIds.set(photo.contentSha256, att.id);
      stored.push({
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
        contentSha256: photo.contentSha256,
        createdAt: att.createdAt.toISOString(),
        source: "internal",
        customerVisible: false,
        skipped: false,
      });
    }
  });

  for (const item of skipped) {
    if (!item.duplicateOf) {
      item.duplicateOf = storedIds.get(item.contentSha256) ?? item.duplicateOf;
    }
  }

  return { ok: true, photos: stored, skipped };
}

function hashOfStoredPhoto(fileContent: string, externalMediaId: string | null): string | null {
  if (externalMediaId?.startsWith("sha256:")) {
    const hex = externalMediaId.slice("sha256:".length);
    if (/^[a-f0-9]{64}$/.test(hex)) return hex;
  }
  const normalised = normaliseBase64(fileContent.trim());
  if (!normalised) return null;
  try {
    return createHash("sha256").update(Buffer.from(normalised, "base64")).digest("hex");
  } catch {
    return null;
  }
}
