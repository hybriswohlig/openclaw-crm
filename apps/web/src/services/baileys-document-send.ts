/**
 * Send one or more WhatsApp documents through the in-house Baileys bridge
 * and log each one on the CRM conversation the same way other outbound
 * media is logged (message row + attachment bytes).
 *
 * The bridge secret stays inside `callBridgeSend`. This module never reads it.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { MAX_DEAL_DOCUMENT_SIZE } from "@/lib/deal-document-upload";
import { normaliseBase64 } from "@/lib/attachment-content";
import {
  bootstrapBaileysConversation,
  sendBaileysMediaReply,
  sendBaileysReply,
} from "@/services/inbox-whatsapp";
import { createDealForNewConversation } from "@/services/inbox";
import {
  WhatsAppDocumentInputError,
  captionForDocument,
  documentSha256,
  duplicateDocumentHit,
  outboundDocumentHeaders,
  resolveBodyDelivery,
  safeDocumentFilename,
  type BodyDelivery,
  type WhatsAppAttachmentDescriptor,
} from "@/services/whatsapp-document";

export interface ResolvedWhatsAppDocument {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  sha256: string;
}

export interface DocumentSendOutcome {
  conversationId: string;
  /** First message of this send (the document, or the existing row on a dedupe hit). */
  message: typeof inboxMessages.$inferSelect | null;
  messages: Array<typeof inboxMessages.$inferSelect>;
  deduped: boolean;
}

async function withDocumentLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const lock = `wa-doc:${key}`.slice(0, 180);
  let locked = false;
  try {
    await db.execute(sql`select pg_advisory_lock(hashtext(${lock}))`);
    locked = true;
  } catch (err) {
    console.error("[baileys-document] advisory lock unavailable:", err instanceof Error ? err.message : "lock failed");
  }
  try {
    return await fn();
  } finally {
    if (locked) {
      await db.execute(sql`select pg_advisory_unlock(hashtext(${lock}))`).catch((err) => {
        console.error(
          "[baileys-document] advisory unlock failed:",
          err instanceof Error ? err.message : "unlock failed"
        );
      });
    }
  }
}

async function loadMarkers(conversationId: string, workspaceId: string) {
  return db
    .select({
      id: inboxMessages.id,
      rawHeaders: inboxMessages.rawHeaders,
      sentAt: inboxMessages.sentAt,
    })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.workspaceId, workspaceId),
        eq(inboxMessages.direction, "outbound")
      )
    )
    .orderBy(desc(inboxMessages.sentAt))
    .limit(100);
}

async function loadMessage(id: string) {
  const [row] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, id)).limit(1);
  return row ?? null;
}

export async function resolveWhatsAppDocuments(opts: {
  workspaceId: string;
  dealRecordId: string | null;
  attachments: WhatsAppAttachmentDescriptor[];
}): Promise<ResolvedWhatsAppDocument[]> {
  const out: ResolvedWhatsAppDocument[] = [];
  for (const attachment of opts.attachments) {
    if (attachment.kind === "inline") {
      const bytes = Buffer.from(attachment.dataBase64, "base64");
      out.push({
        filename: safeDocumentFilename(attachment.filename, attachment.contentType),
        mimeType: attachment.contentType,
        bytes,
        sha256: documentSha256(bytes),
      });
      continue;
    }
    if (!opts.dealRecordId) {
      throw new WhatsAppDocumentInputError(
        "dealDocumentId needs a conversation linked to a deal (or dealRecordId on a first send)",
        400
      );
    }
    const [doc] = await db
      .select({
        fileName: dealDocuments.fileName,
        mimeType: dealDocuments.mimeType,
        fileSize: dealDocuments.fileSize,
        fileContent: dealDocuments.fileContent,
      })
      .from(dealDocuments)
      .where(
        and(
          eq(dealDocuments.id, attachment.dealDocumentId),
          eq(dealDocuments.workspaceId, opts.workspaceId),
          eq(dealDocuments.dealRecordId, opts.dealRecordId)
        )
      )
      .limit(1);
    if (!doc) {
      throw new WhatsAppDocumentInputError("Deal document not found", 404);
    }
    const normalised = normaliseBase64(doc.fileContent);
    const bytes = Buffer.from(normalised, "base64");
    if (bytes.length === 0) {
      throw new WhatsAppDocumentInputError("Deal document is empty", 400);
    }
    if (bytes.length > MAX_DEAL_DOCUMENT_SIZE) {
      throw new WhatsAppDocumentInputError("File too large (max 10 MB)", 413);
    }
    const filename = safeDocumentFilename(attachment.filename || doc.fileName, doc.mimeType);
    out.push({
      filename,
      mimeType: doc.mimeType || "application/pdf",
      bytes,
      sha256: documentSha256(bytes),
    });
  }
  return out;
}

async function deliverDocuments(opts: {
  conversationId: string;
  workspaceId: string;
  body: string;
  delivery: BodyDelivery;
  documents: ResolvedWhatsAppDocument[];
  idempotencyKey?: string;
  /** When separate, the text was already delivered by the caller. */
  textAlreadySent?: boolean;
}): Promise<DocumentSendOutcome> {
  const markers = await loadMarkers(opts.conversationId, opts.workspaceId);
  const now = new Date();
  if (opts.idempotencyKey) {
    const prior = duplicateDocumentHit(markers, {
      sha256: "",
      idempotencyKey: opts.idempotencyKey,
      now,
    });
    if (prior) {
      const message = await loadMessage(prior.messageId);
      return {
        conversationId: opts.conversationId,
        message,
        messages: message ? [message] : [],
        deduped: true,
      };
    }
  }

  const sent: Array<typeof inboxMessages.$inferSelect> = [];
  let sentNew = 0;
  for (let index = 0; index < opts.documents.length; index++) {
    const doc = opts.documents[index]!;
    const outcome = await withDocumentLock(`${opts.conversationId}:${doc.sha256}`, async () => {
      const latest = await loadMarkers(opts.conversationId, opts.workspaceId);
      const hit = duplicateDocumentHit(latest, { sha256: doc.sha256, now: new Date() });
      if (hit) return { row: await loadMessage(hit.messageId), created: false };
      const caption = captionForDocument(opts.body, opts.delivery, index);
      const row = await sendBaileysMediaReply({
        conversationId: opts.conversationId,
        workspaceId: opts.workspaceId,
        file: {
          blob: new Blob([new Uint8Array(doc.bytes)], { type: doc.mimeType }),
          mimeType: doc.mimeType,
          filename: doc.filename,
          size: doc.bytes.length,
        },
        caption,
        asDocument: true,
        rawHeaders: outboundDocumentHeaders({
          documentSha256: doc.sha256,
          idempotencyKey: index === 0 ? opts.idempotencyKey : undefined,
        }),
      });
      return { row, created: true };
    });
    if (outcome.row) sent.push(outcome.row);
    if (outcome.created) sentNew += 1;
  }

  const sendText =
    opts.delivery === "separate" &&
    opts.body.trim().length > 0 &&
    !opts.textAlreadySent &&
    sentNew > 0;
  if (sendText) {
    const textRow = await sendBaileysReply({
      conversationId: opts.conversationId,
      workspaceId: opts.workspaceId,
      body: opts.body,
    });
    if (textRow) sent.push(textRow);
  }

  return {
    conversationId: opts.conversationId,
    message: sent[0] ?? null,
    messages: sent,
    deduped: sentNew === 0,
  };
}

export async function sendConversationDocuments(opts: {
  conversationId: string;
  workspaceId: string;
  dealRecordId: string | null;
  body: string;
  attachments: WhatsAppAttachmentDescriptor[];
  bodyDelivery?: BodyDelivery;
  idempotencyKey?: string;
}): Promise<DocumentSendOutcome> {
  const delivery = resolveBodyDelivery(opts.body, opts.bodyDelivery);
  const run = async () => {
    const documents = await resolveWhatsAppDocuments({
      workspaceId: opts.workspaceId,
      dealRecordId: opts.dealRecordId,
      attachments: opts.attachments,
    });
    return deliverDocuments({
      conversationId: opts.conversationId,
      workspaceId: opts.workspaceId,
      body: opts.body,
      delivery,
      documents,
      idempotencyKey: opts.idempotencyKey,
    });
  };
  if (!opts.idempotencyKey) return run();
  return withDocumentLock(`${opts.conversationId}:${opts.idempotencyKey}`, run);
}

export async function sendBaileysOpeningDocuments(opts: {
  workspaceId: string;
  channelAccountId: string;
  toPhone: string;
  customerName: string;
  dealRecordId?: string | null;
  body: string;
  attachments: WhatsAppAttachmentDescriptor[];
  bodyDelivery?: BodyDelivery;
  idempotencyKey?: string;
}): Promise<DocumentSendOutcome> {
  const delivery = resolveBodyDelivery(opts.body, opts.bodyDelivery);
  const dealRecordId = opts.dealRecordId ?? null;
  // Resolve before opening a thread so a missing document does not create one.
  const documents = await resolveWhatsAppDocuments({
    workspaceId: opts.workspaceId,
    dealRecordId,
    attachments: opts.attachments,
  });
  const lockKey = `${opts.channelAccountId}:${opts.toPhone}:${
    opts.idempotencyKey ?? documents.map((doc) => doc.sha256).join(":")
  }`;
  return withDocumentLock(lockKey, async () => {
  const preview =
    delivery === "separate" && opts.body.trim()
      ? opts.body
      : (documents[0]?.filename ?? "Dokument");
  const boot = await bootstrapBaileysConversation({
    workspaceId: opts.workspaceId,
    channelAccountId: opts.channelAccountId,
    toPhone: opts.toPhone,
    customerName: opts.customerName,
    dealRecordId,
    preview,
  });
  try {
    const docs = await deliverDocuments({
      conversationId: boot.conv.id,
      workspaceId: opts.workspaceId,
      body: opts.body,
      delivery,
      documents,
      idempotencyKey: opts.idempotencyKey,
    });
    if (boot.createdNewConversation && !boot.conv.dealRecordId && !docs.deduped) {
      await createDealForNewConversation({
        workspaceId: opts.workspaceId,
        conversationId: boot.conv.id,
        dealName: opts.customerName || boot.waId,
        contactId: boot.contactId,
        channelAccountId: opts.channelAccountId,
      });
    }
    return { ...docs, conversationId: boot.conv.id };
  } catch (err) {
    if (boot.createdNewConversation) {
      const stored = await loadMarkers(boot.conv.id, opts.workspaceId);
      if (stored.length === 0) {
        await db.delete(inboxConversations).where(eq(inboxConversations.id, boot.conv.id));
      }
    }
    throw err;
  }
  });
}
