// Agent-uploaded deal photos live on the deal, not in a chat.
// inbox_message_attachments requires a message and a conversation, which
// ImmoScout leads often do not have. New uploads go to deal_internal_photos.
// Older internal-photo:* inbox rows stay readable and stay hidden from chat,
// reply-state and the public portal.

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealInternalPhotos } from "@/db/schema/deal-internal-photos";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { normaliseBase64 } from "@/lib/attachment-content";
import {
  INTERNAL_PHOTO_PREFIX,
  PORTAL_UPLOAD_PREFIX,
  type PreparedDealPhoto,
} from "@/lib/deal-photo-upload";

/**
 * Not an outbound send. `received` is outside ANTWORT_STATUS, so historical
 * internal-photo:* rows do not clear „wartet auf Antwort“. New uploads do
 * not create a message at all.
 */
export const INTERNAL_PHOTO_MESSAGE_STATUS = "received" as const;

/** Synthetic source marker for deal-table rows. Not a message id. */
const DEAL_TABLE_PHOTO_MARKER = `${INTERNAL_PHOTO_PREFIX}deal`;

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
  | { ok: false; status: 404; code: "NOT_FOUND"; error: string };

export interface DealInternalPhotoMeta {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  dealRecordId: string;
}

export interface DealInternalPhotoFile extends DealInternalPhotoMeta {
  fileContent: string;
}

/**
 * Write internal photos onto the deal itself.
 * No conversation, no inbox message, no bridge send.
 * Same content hash as an image already on the deal (inbox or this table) is skipped.
 * A later customer chat does not move or hide these rows.
 */
export async function uploadInternalDealPhotos(input: {
  workspaceId: string;
  dealRecordId: string;
  photos: PreparedDealPhoto[];
}): Promise<UploadInternalDealPhotosResult> {
  const [deal] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, input.dealRecordId),
        eq(objects.workspaceId, input.workspaceId),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  if (!deal) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      error: "Deal not found.",
    };
  }

  const existingInbox = await db
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

  const existingDeal = await db
    .select({
      id: dealInternalPhotos.id,
      contentSha256: dealInternalPhotos.contentSha256,
    })
    .from(dealInternalPhotos)
    .where(
      and(
        eq(dealInternalPhotos.workspaceId, input.workspaceId),
        eq(dealInternalPhotos.dealRecordId, input.dealRecordId)
      )
    );

  const hashes = new Map<string, string>();
  for (const row of existingDeal) {
    if (/^[a-f0-9]{64}$/.test(row.contentSha256) && !hashes.has(row.contentSha256)) {
      hashes.set(row.contentSha256, row.id);
    }
  }
  for (const row of existingInbox) {
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

  const stored: StoredInternalDealPhoto[] = [];
  const storedIds = new Map<string, string>();
  await db.transaction(async (tx) => {
    for (const photo of toInsert) {
      try {
        const [att] = await tx
          .insert(dealInternalPhotos)
          .values({
            workspaceId: input.workspaceId,
            dealRecordId: input.dealRecordId,
            fileName: photo.fileName,
            mimeType: photo.mimeType,
            fileSize: photo.fileSize,
            fileContent: photo.fileContent,
            contentSha256: photo.contentSha256,
          })
          .returning({
            id: dealInternalPhotos.id,
            fileName: dealInternalPhotos.fileName,
            mimeType: dealInternalPhotos.mimeType,
            fileSize: dealInternalPhotos.fileSize,
            createdAt: dealInternalPhotos.createdAt,
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
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [existing] = await tx
          .select({ id: dealInternalPhotos.id })
          .from(dealInternalPhotos)
          .where(
            and(
              eq(dealInternalPhotos.workspaceId, input.workspaceId),
              eq(dealInternalPhotos.dealRecordId, input.dealRecordId),
              eq(dealInternalPhotos.contentSha256, photo.contentSha256)
            )
          )
          .limit(1);
        skipped.push({
          fileName: photo.fileName,
          contentSha256: photo.contentSha256,
          duplicateOf: existing?.id ?? "",
          skipped: true,
          reason: "duplicate",
        });
      }
    }
  });

  for (const item of skipped) {
    if (!item.duplicateOf) {
      item.duplicateOf = storedIds.get(item.contentSha256) ?? item.duplicateOf;
    }
  }

  return { ok: true, photos: stored, skipped };
}

/** Metadata for Medien and the deal photo step. Bytes stay out of this list. */
export async function listDealInternalPhotos(
  workspaceId: string,
  dealRecordId: string
): Promise<DealInternalPhotoMeta[]> {
  return db
    .select({
      id: dealInternalPhotos.id,
      fileName: dealInternalPhotos.fileName,
      mimeType: dealInternalPhotos.mimeType,
      fileSize: dealInternalPhotos.fileSize,
      createdAt: dealInternalPhotos.createdAt,
      dealRecordId: dealInternalPhotos.dealRecordId,
    })
    .from(dealInternalPhotos)
    .where(
      and(
        eq(dealInternalPhotos.workspaceId, workspaceId),
        eq(dealInternalPhotos.dealRecordId, dealRecordId)
      )
    )
    .orderBy(desc(dealInternalPhotos.createdAt));
}

/** Image bytes for KI scope and deal analysis. Optional id filter. */
export async function listDealInternalPhotoFiles(
  workspaceId: string,
  dealRecordId: string,
  ids?: string[]
): Promise<DealInternalPhotoFile[]> {
  if (ids && ids.length === 0) return [];
  return db
    .select({
      id: dealInternalPhotos.id,
      fileName: dealInternalPhotos.fileName,
      mimeType: dealInternalPhotos.mimeType,
      fileSize: dealInternalPhotos.fileSize,
      fileContent: dealInternalPhotos.fileContent,
      createdAt: dealInternalPhotos.createdAt,
      dealRecordId: dealInternalPhotos.dealRecordId,
    })
    .from(dealInternalPhotos)
    .where(
      and(
        eq(dealInternalPhotos.workspaceId, workspaceId),
        eq(dealInternalPhotos.dealRecordId, dealRecordId),
        like(dealInternalPhotos.mimeType, "image/%"),
        ...(ids ? [inArray(dealInternalPhotos.id, ids)] : [])
      )
    )
    .orderBy(desc(dealInternalPhotos.createdAt));
}

export async function findDealInternalPhoto(
  workspaceId: string,
  photoId: string,
  opts: { dealRecordId?: string } = {}
): Promise<DealInternalPhotoFile | null> {
  const [row] = await db
    .select({
      id: dealInternalPhotos.id,
      fileName: dealInternalPhotos.fileName,
      mimeType: dealInternalPhotos.mimeType,
      fileSize: dealInternalPhotos.fileSize,
      fileContent: dealInternalPhotos.fileContent,
      createdAt: dealInternalPhotos.createdAt,
      dealRecordId: dealInternalPhotos.dealRecordId,
    })
    .from(dealInternalPhotos)
    .where(
      and(
        eq(dealInternalPhotos.id, photoId),
        eq(dealInternalPhotos.workspaceId, workspaceId),
        ...(opts.dealRecordId
          ? [eq(dealInternalPhotos.dealRecordId, opts.dealRecordId)]
          : [])
      )
    )
    .limit(1);
  return row ?? null;
}

/** Workspace-scoped lookup for explicit photo ids (document jobs, content). */
export async function findDealInternalPhotosByIds(
  workspaceId: string,
  ids: string[],
  dealRecordId?: string
): Promise<DealInternalPhotoFile[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: dealInternalPhotos.id,
      fileName: dealInternalPhotos.fileName,
      mimeType: dealInternalPhotos.mimeType,
      fileSize: dealInternalPhotos.fileSize,
      fileContent: dealInternalPhotos.fileContent,
      createdAt: dealInternalPhotos.createdAt,
      dealRecordId: dealInternalPhotos.dealRecordId,
    })
    .from(dealInternalPhotos)
    .where(
      and(
        eq(dealInternalPhotos.workspaceId, workspaceId),
        inArray(dealInternalPhotos.id, ids),
        ...(dealRecordId ? [eq(dealInternalPhotos.dealRecordId, dealRecordId)] : [])
      )
    );
}

/** Ids from `ids` that are internal photos on this deal. */
export async function filterDealInternalPhotoIds(
  workspaceId: string,
  dealRecordId: string,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: dealInternalPhotos.id })
    .from(dealInternalPhotos)
    .where(
      and(
        eq(dealInternalPhotos.workspaceId, workspaceId),
        eq(dealInternalPhotos.dealRecordId, dealRecordId),
        inArray(dealInternalPhotos.id, ids),
        like(dealInternalPhotos.mimeType, "image/%")
      )
    );
  return rows.map((row) => row.id);
}

/** Map a deal-table photo onto the shape the portal grid already understands. */
export function asDealSurfacePhoto(row: DealInternalPhotoMeta) {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    direction: "outbound" as const,
    externalMessageId: DEAL_TABLE_PHOTO_MARKER,
  };
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

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
