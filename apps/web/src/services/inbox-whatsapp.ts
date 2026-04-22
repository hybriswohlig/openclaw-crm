/**
 * WhatsApp Business (Meta Cloud API) ingest + send.
 *
 * Runs server-side only (Node.js). Never import from client components.
 *
 * Routing invariant: every inbound and outbound operation keys off
 * `channelAccounts.waPhoneNumberId`. A new company = a new row. There is no
 * env-var fallback or "default account" — if the phone_number_id on an
 * incoming webhook does not match a channel account row, the event is
 * dropped. This is how replies are guaranteed to go out under the correct
 * business.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxContacts,
  inboxMessages,
  inboxMessageAttachments,
  whatsappTemplateMetadata,
} from "@/db/schema/inbox";
import { eq, and, desc } from "drizzle-orm";
import { createDealForNewConversation } from "./inbox";
import { emitEvent } from "./activity-events";
import { getSecret } from "./workspace-settings";
import { ensureCrmPerson } from "./inbox-crm-link";

// ─── Settings keys ────────────────────────────────────────────────────────────
// App-level values, stored once per workspace in workspace_settings (encrypted).

export const WA_APP_SECRET_KEY = "whatsapp.app_secret";
export const WA_VERIFY_TOKEN_KEY = "whatsapp.verify_token";

// Meta Graph API version. Pinning this keeps payload shape stable.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ─── Signature verification ───────────────────────────────────────────────────
// Meta signs every webhook POST with HMAC-SHA256 using the App Secret.
// The header is "x-hub-signature-256: sha256=<hex>".

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

// ─── Webhook payload types (minimal, only what we read) ───────────────────────

interface WAContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WAMessageBase {
  id: string;
  from: string;
  timestamp: string;
  type: string;
}

interface WATextMessage extends WAMessageBase {
  type: "text";
  text: { body: string };
}

interface WAMediaMessage extends WAMessageBase {
  type: "image" | "video" | "audio" | "document" | "sticker";
  [key: string]: unknown;
}

interface WAInteractiveMessage extends WAMessageBase {
  type: "interactive";
  interactive: { type: string; button_reply?: { title: string }; list_reply?: { title: string } };
}

interface WAButtonMessage extends WAMessageBase {
  type: "button";
  button: { text: string };
}

type WAMessage = WATextMessage | WAMediaMessage | WAInteractiveMessage | WAButtonMessage | WAMessageBase;

interface WAStatus {
  id: string;
  recipient_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
}

interface WAChangeValue {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: WAContact[];
  messages?: WAMessage[];
  statuses?: WAStatus[];
}

export interface WAWebhookPayload {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{ field: "messages"; value: WAChangeValue }>;
  }>;
}

// ─── Account lookup ───────────────────────────────────────────────────────────

async function findAccountByPhoneNumberId(phoneNumberId: string) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.waPhoneNumberId, phoneNumberId),
        eq(channelAccounts.isActive, true)
      )
    )
    .limit(1);
  return row ?? null;
}

// ─── Contact upsert ───────────────────────────────────────────────────────────

async function upsertContact(
  workspaceId: string,
  waId: string,
  displayName: string
) {
  const [existing] = await db
    .select()
    .from(inboxContacts)
    .where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.phone, waId)))
    .limit(1);
  if (existing) {
    if (displayName && !existing.displayName) {
      await db
        .update(inboxContacts)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(inboxContacts.id, existing.id));
    }
    return existing;
  }
  const [created] = await db
    .insert(inboxContacts)
    .values({ workspaceId, phone: waId, displayName: displayName || waId })
    .returning();
  return created;
}

// ─── Message body extraction ──────────────────────────────────────────────────

// Shape of the nested media payload Meta delivers on image/video/audio/
// document/sticker messages. `caption` is only present on image/video.
interface WAMediaPayload {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

/** Extract the text we want to render in the bubble AND, if this is a media
 *  message, the payload we need to fetch the bytes from Meta. For images and
 *  videos we prefer showing the caption (if any) — the image itself becomes
 *  the primary content, no more "[Bild]" placeholder. */
function extractMessageBody(msg: WAMessage): {
  body: string;
  kind: string;
  media?: WAMediaPayload;
} {
  switch (msg.type) {
    case "text":
      return { body: (msg as WATextMessage).text?.body ?? "", kind: "text" };
    case "interactive": {
      const i = (msg as WAInteractiveMessage).interactive;
      const reply = i.button_reply?.title ?? i.list_reply?.title ?? "";
      return { body: reply, kind: "interactive" };
    }
    case "button":
      return { body: (msg as WAButtonMessage).button?.text ?? "", kind: "button" };
    case "image": {
      const media = (msg as WAMediaMessage).image as WAMediaPayload | undefined;
      return { body: media?.caption ?? "", kind: "image", media };
    }
    case "video": {
      const media = (msg as WAMediaMessage).video as WAMediaPayload | undefined;
      return { body: media?.caption ?? "", kind: "video", media };
    }
    case "audio": {
      const media = (msg as WAMediaMessage).audio as WAMediaPayload | undefined;
      return { body: "[Sprachnachricht]", kind: "audio", media };
    }
    case "document": {
      const media = (msg as WAMediaMessage).document as WAMediaPayload | undefined;
      return {
        body: media?.caption ?? (media?.filename ? `[Dokument] ${media.filename}` : "[Dokument]"),
        kind: "document",
        media,
      };
    }
    case "sticker": {
      const media = (msg as WAMediaMessage).sticker as WAMediaPayload | undefined;
      return { body: "", kind: "sticker", media };
    }
    default:
      return { body: `[${msg.type}]`, kind: msg.type };
  }
}

// ─── Media download from Meta ─────────────────────────────────────────────────
// Two-step: GET /{media_id} returns a short-lived pre-signed URL (expires ~5m)
// and then GET that URL with the same bearer token returns the bytes. We run
// this inline during ingest because the URL expires fast; the webhook handler
// catches and logs errors so a media-fetch failure never drops the message.

const WA_INBOUND_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error(
        `[inbox-whatsapp] media meta fetch failed for ${mediaId}: ${metaRes.status}`
      );
      return null;
    }
    const meta = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };
    if (!meta.url) return null;
    if (meta.file_size && meta.file_size > WA_INBOUND_MEDIA_MAX_BYTES) {
      console.warn(
        `[inbox-whatsapp] media ${mediaId} exceeds size cap (${meta.file_size} bytes), skipping`
      );
      return null;
    }
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      console.error(
        `[inbox-whatsapp] media bytes fetch failed for ${mediaId}: ${fileRes.status}`
      );
      return null;
    }
    const ab = await fileRes.arrayBuffer();
    if (ab.byteLength > WA_INBOUND_MEDIA_MAX_BYTES) {
      console.warn(
        `[inbox-whatsapp] media ${mediaId} over cap after download (${ab.byteLength})`
      );
      return null;
    }
    return {
      bytes: Buffer.from(ab),
      mimeType: meta.mime_type || fileRes.headers.get("content-type") || "application/octet-stream",
    };
  } catch (err) {
    console.error(`[inbox-whatsapp] media download threw for ${mediaId}:`, err);
    return null;
  }
}

/** Guess a sensible filename from mime type when Meta doesn't provide one. */
function filenameForMedia(kind: string, mime: string, provided?: string): string {
  if (provided) return provided;
  const ext = mime.split("/")[1]?.split(";")[0] || "bin";
  return `${kind}.${ext}`;
}

// ─── Ingest: inbound messages ─────────────────────────────────────────────────

async function ingestMessage(
  account: typeof channelAccounts.$inferSelect,
  value: WAChangeValue,
  msg: WAMessage
) {
  const waId = msg.from;
  const contactProfile = value.contacts?.find((c) => c.wa_id === waId);
  const displayName = contactProfile?.profile?.name ?? "";
  const { body, kind, media } = extractMessageBody(msg);
  const sentAt = new Date(Number(msg.timestamp) * 1000);

  // Preview shown in the conversation list. For media-only messages without
  // a caption we fall back to a friendly label so the list has something
  // readable ("📷 Bild") instead of an empty cell.
  const previewLabelForKind =
    kind === "image"
      ? "📷 Bild"
      : kind === "video"
        ? "🎞️ Video"
        : kind === "audio"
          ? "🎤 Sprachnachricht"
          : kind === "document"
            ? "📎 Dokument"
            : kind === "sticker"
              ? "🏷️ Sticker"
              : "";
  const previewText = body.trim() || previewLabelForKind || body;

  const contact = await upsertContact(account.workspaceId, waId, displayName);

  // Auto-create CRM Person for the contact (idempotent).
  await ensureCrmPerson({
    workspaceId: account.workspaceId,
    contactId: contact.id,
    displayName: displayName || waId,
    email: null,
    phone: waId,
    leadSource: "WhatsApp / Website",
  });

  // Thread key for WhatsApp = wa_id. One conversation per (channelAccount, contact phone).
  const threadKey = waId;

  let [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.channelAccountId, account.id),
        eq(inboxConversations.externalThreadId, threadKey)
      )
    )
    .limit(1);

  const preview = previewText.slice(0, 120).replace(/\s+/g, " ");

  if (!conv) {
    const [created] = await db
      .insert(inboxConversations)
      .values({
        workspaceId: account.workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: threadKey,
        subject: null,
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: 1,
      })
      .returning();
    conv = created;

    // Mirror the email flow: auto-create a deal for brand-new inbound
    // conversations so WhatsApp inquiries show up on the pipeline board.
    await createDealForNewConversation({
      workspaceId: account.workspaceId,
      conversationId: conv.id,
      dealName: displayName || waId,
      contactId: contact.id,
      channelAccountId: account.id,
    });
  } else {
    await db
      .update(inboxConversations)
      .set({
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: (conv.unreadCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(inboxConversations.id, conv.id));
  }

  // Idempotent insert via (conversation_id, external_message_id) unique index.
  // Meta retries webhooks aggressively; we must dedupe in-path.
  let storedMessageId: string | null = null;
  try {
    const [stored] = await db
      .insert(inboxMessages)
      .values({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        direction: "inbound",
        status: "received",
        externalMessageId: msg.id,
        fromAddress: waId,
        toAddress: value.metadata.phone_number_id,
        subject: null,
        body,
        isRead: false,
        rawHeaders: JSON.stringify({ type: msg.type, timestamp: msg.timestamp }),
        sentAt,
      })
      .returning({ id: inboxMessages.id });
    storedMessageId = stored?.id ?? null;
  } catch (err) {
    // Unique violation → duplicate delivery. Swallow and move on.
    if (err instanceof Error && /duplicate key|unique/i.test(err.message)) return;
    throw err;
  }

  // Download + persist media (image/video/audio/document/sticker). This
  // replaces the old "[Bild]" placeholder: the actual bytes end up in
  // inbox_message_attachments, linked to both the message and the deal.
  if (storedMessageId && media?.id && account.credential) {
    const downloaded = await downloadWhatsAppMedia(media.id, account.credential);
    if (downloaded) {
      const mime = media.mime_type || downloaded.mimeType;
      const filename = filenameForMedia(msg.type, mime, media.filename);
      try {
        await db.insert(inboxMessageAttachments).values({
          workspaceId: account.workspaceId,
          messageId: storedMessageId,
          conversationId: conv.id,
          dealRecordId: conv.dealRecordId ?? null,
          fileName: filename,
          mimeType: mime,
          fileSize: downloaded.bytes.length,
          fileContent: downloaded.bytes.toString("base64"),
          externalMediaId: media.id,
        });
      } catch (attErr) {
        console.error(
          `[inbox-whatsapp] failed to store attachment for ${msg.id}:`,
          attErr
        );
      }
    }
  }

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId: account.workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.received",
      payload: {
        conversationId: conv.id,
        channelType: "whatsapp",
        fromAddress: waId,
        externalMessageId: msg.id,
      },
    });
  }
}

// ─── Ingest: delivery status updates ──────────────────────────────────────────

async function ingestStatus(
  account: typeof channelAccounts.$inferSelect,
  status: WAStatus
) {
  const nextStatus =
    status.status === "failed"
      ? "failed"
      : status.status === "delivered" || status.status === "read"
        ? "delivered"
        : "sent";

  await db
    .update(inboxMessages)
    .set({ status: nextStatus })
    .where(
      and(
        eq(inboxMessages.workspaceId, account.workspaceId),
        eq(inboxMessages.externalMessageId, status.id)
      )
    );
}

// ─── Webhook dispatch ─────────────────────────────────────────────────────────

export async function handleWebhookPayload(payload: WAWebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const account = await findAccountByPhoneNumberId(phoneNumberId);
      if (!account) {
        console.warn(
          `[inbox-whatsapp] no channel_account for phone_number_id=${phoneNumberId} — dropping event`
        );
        continue;
      }

      for (const msg of value.messages ?? []) {
        try {
          await ingestMessage(account, value, msg);
        } catch (err) {
          console.error("[inbox-whatsapp] ingestMessage failed:", err);
        }
      }
      for (const status of value.statuses ?? []) {
        try {
          await ingestStatus(account, status);
        } catch (err) {
          console.error("[inbox-whatsapp] ingestStatus failed:", err);
        }
      }
    }
  }
}

// ─── Outbound send ────────────────────────────────────────────────────────────

// Meta only allows free-form text within the 24h customer service window.
// Outside that window you must send an approved template message. v1 blocks
// the send and surfaces an error — template support is a follow-up.
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppSessionExpiredError extends Error {
  constructor() {
    super(
      "WhatsApp 24-hour session window has expired. Template messages are required (not yet implemented)."
    );
    this.name = "WhatsAppSessionExpiredError";
  }
}

async function isWithinCustomerServiceWindow(conversationId: string): Promise<boolean> {
  const [lastInbound] = await db
    .select({ sentAt: inboxMessages.sentAt, createdAt: inboxMessages.createdAt })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.direction, "inbound")
      )
    )
    .orderBy(desc(inboxMessages.sentAt))
    .limit(1);
  if (!lastInbound) return false;
  const ts = (lastInbound.sentAt ?? lastInbound.createdAt ?? new Date(0)).getTime();
  return Date.now() - ts < CUSTOMER_SERVICE_WINDOW_MS;
}

export async function sendWhatsAppReply(params: {
  conversationId: string;
  workspaceId: string;
  body: string;
}) {
  const { conversationId, workspaceId, body } = params;

  const [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!conv) throw new Error("Conversation not found");

  // Critical: read account by the conversation's FK. Never guess.
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, conv.channelAccountId))
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Conversation is not a WhatsApp conversation");
  }
  if (!account.waPhoneNumberId || !account.credential) {
    throw new Error("WhatsApp channel account is missing phone_number_id or access token");
  }

  if (!(await isWithinCustomerServiceWindow(conversationId))) {
    throw new WhatsAppSessionExpiredError();
  }

  const [contact] = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1);
  const toWaId = contact?.phone ?? conv.externalThreadId;
  if (!toWaId) throw new Error("Cannot determine recipient wa_id");

  const res = await fetch(`${GRAPH_API_BASE}/${account.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    const errMsg = json.error?.message ?? `Meta API error ${res.status}`;
    throw new Error(`WhatsApp send failed: ${errMsg}`);
  }

  const externalId = json.messages?.[0]?.id ?? null;

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: externalId,
      fromAddress: account.waPhoneNumberId,
      toAddress: toWaId,
      subject: null,
      body,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${body.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId,
        channelType: "whatsapp",
        toAddress: toWaId,
        externalMessageId: externalId,
      },
    });
  }

  return stored;
}

// ─── Media replies (image / document / video / audio) ────────────────────────
// Two-step with Meta: upload the bytes to `/media` to get a media_id, then
// send a `/messages` payload that references it. We go through the media_id
// path (not the public-URL path) because operator-picked files from the
// browser aren't publicly hosted anywhere. Same 24h window rule as text.

type WhatsAppMediaKind = "image" | "document" | "video" | "audio";

/** Pick the WhatsApp media kind from a MIME type. Meta has hard lists — see
 *  https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media. */
function mimeToWhatsAppKind(mime: string): WhatsAppMediaKind | null {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  // Everything else Meta accepts (pdf, docx, xlsx, txt, …) rides as document.
  return "document";
}

/** Upper bounds from Meta. Stickers aren't supported here. */
const WA_MEDIA_MAX_BYTES: Record<WhatsAppMediaKind, number> = {
  image: 5 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
};

export class WhatsAppMediaTooLargeError extends Error {
  constructor(kind: WhatsAppMediaKind, bytes: number) {
    const mb = (WA_MEDIA_MAX_BYTES[kind] / 1024 / 1024) | 0;
    super(`File too large for ${kind}: max ${mb} MB, got ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    this.name = "WhatsAppMediaTooLargeError";
  }
}

export async function sendWhatsAppMediaReply(params: {
  conversationId: string;
  workspaceId: string;
  file: {
    blob: Blob;
    mimeType: string;
    filename: string;
    size: number;
  };
  caption?: string;
}) {
  const { conversationId, workspaceId, file, caption } = params;

  const kind = mimeToWhatsAppKind(file.mimeType);
  if (!kind) throw new Error(`Unsupported MIME type: ${file.mimeType}`);
  if (file.size > WA_MEDIA_MAX_BYTES[kind]) {
    throw new WhatsAppMediaTooLargeError(kind, file.size);
  }

  const [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!conv) throw new Error("Conversation not found");

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, conv.channelAccountId))
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Conversation is not a WhatsApp conversation");
  }
  if (!account.waPhoneNumberId || !account.credential) {
    throw new Error("WhatsApp channel account is missing phone_number_id or access token");
  }

  if (!(await isWithinCustomerServiceWindow(conversationId))) {
    throw new WhatsAppSessionExpiredError();
  }

  const [contact] = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1);
  const toWaId = contact?.phone ?? conv.externalThreadId;
  if (!toWaId) throw new Error("Cannot determine recipient wa_id");

  // 1) Upload the bytes to Meta's media endpoint → media_id.
  const uploadForm = new FormData();
  uploadForm.append("messaging_product", "whatsapp");
  uploadForm.append("type", file.mimeType);
  uploadForm.append("file", file.blob, file.filename);
  const uploadRes = await fetch(
    `${GRAPH_API_BASE}/${account.waPhoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${account.credential}` },
      body: uploadForm,
    }
  );
  const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!uploadRes.ok || !uploadJson.id) {
    throw new Error(
      `WhatsApp media upload failed: ${uploadJson.error?.message ?? `Meta ${uploadRes.status}`}`
    );
  }
  const mediaId = uploadJson.id;

  // 2) Send a message that references the media_id.
  const mediaPayload: Record<string, string> = { id: mediaId };
  if (caption?.trim()) mediaPayload.caption = caption.trim();
  if (kind === "document") mediaPayload.filename = file.filename;

  const sendRes = await fetch(
    `${GRAPH_API_BASE}/${account.waPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toWaId,
        type: kind,
        [kind]: mediaPayload,
      }),
    }
  );
  const sendJson = (await sendRes.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!sendRes.ok) {
    throw new Error(
      `WhatsApp send failed: ${sendJson.error?.message ?? `Meta ${sendRes.status}`}`
    );
  }
  const externalId = sendJson.messages?.[0]?.id ?? null;

  const previewLabel =
    kind === "image"
      ? "[Bild]"
      : kind === "video"
        ? "[Video]"
        : kind === "audio"
          ? "[Audio]"
          : `[Dokument] ${file.filename}`;
  const bodyText = caption?.trim()
    ? `${previewLabel} ${caption.trim()}`
    : previewLabel;

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: externalId,
      fromAddress: account.waPhoneNumberId,
      toAddress: toWaId,
      subject: null,
      body: bodyText,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${bodyText.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId,
        channelType: "whatsapp",
        toAddress: toWaId,
        externalMessageId: externalId,
        mediaKind: kind,
      },
    });
  }

  return stored;
}

// ─── Start-from-record (open existing chat or compose new) ───────────────────
// Called from the Leads/Deals table. Resolves the deal's operating company
// and linked Person to decide what the user sees next: either jump to an
// existing WhatsApp conversation (back-filling the deal link if missing) or
// open the compose dialog pre-filled so a template send creates the linked
// conversation in one step. One lead = one operating company = one chat, per
// the product invariant.

export type StartFromRecordResult =
  | { mode: "open"; conversationId: string }
  | {
      mode: "compose";
      channelAccountId: string;
      toPhone: string;
      customerName: string;
      dealRecordId: string;
    };

export class StartFromRecordError extends Error {
  constructor(
    public code:
      | "NO_PHONE"
      | "NO_OPERATING_COMPANY"
      | "NO_WHATSAPP_ACCOUNT"
      | "NOT_A_DEAL",
    message: string
  ) {
    super(message);
    this.name = "StartFromRecordError";
  }
}

export async function startWhatsAppChatFromRecord(params: {
  workspaceId: string;
  recordId: string;
}): Promise<StartFromRecordResult> {
  const { workspaceId, recordId } = params;

  const { getObjectBySlug } = await import("./objects");
  const { getRecord } = await import("./records");

  const dealsObject = await getObjectBySlug(workspaceId, "deals");
  if (!dealsObject) {
    throw new StartFromRecordError(
      "NOT_A_DEAL",
      "Deals object not found in this workspace"
    );
  }

  const deal = await getRecord(dealsObject.id, recordId);
  if (!deal) {
    throw new StartFromRecordError("NOT_A_DEAL", "Lead not found");
  }

  // Operating company scopes which WhatsApp account this chat lives under.
  // Without it we can't pick the right channel account — per the rule that
  // leads are 1:1 with operating companies.
  const opRef = deal.values.operating_company as
    | { id: string }
    | null
    | undefined;
  const operatingCompanyRecordId = opRef?.id ?? null;
  if (!operatingCompanyRecordId) {
    throw new StartFromRecordError(
      "NO_OPERATING_COMPANY",
      "This lead has no operating company set — can't pick a WhatsApp account."
    );
  }

  // Resolve the linked Person → phone + display name.
  const peopleRefs = deal.values.associated_people as
    | Array<{ id: string; displayName?: string }>
    | null
    | undefined;
  const personId = peopleRefs?.[0]?.id ?? null;

  let phone: string | null = null;
  let customerName = "";
  if (personId) {
    const peopleObject = await getObjectBySlug(workspaceId, "people");
    if (peopleObject) {
      const person = await getRecord(peopleObject.id, personId);
      if (person) {
        const phones = person.values.phone_numbers as
          | string[]
          | string
          | null
          | undefined;
        phone = Array.isArray(phones) ? phones[0] ?? null : phones ?? null;
        const nameVal = person.values.name as
          | {
              first_name?: string;
              last_name?: string;
              full_name?: string;
            }
          | string
          | null
          | undefined;
        if (typeof nameVal === "string") {
          customerName = nameVal;
        } else if (nameVal) {
          customerName =
            nameVal.full_name ??
            [nameVal.first_name, nameVal.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();
        }
      }
    }
  }
  if (!customerName) {
    customerName =
      (peopleRefs?.[0]?.displayName as string | undefined) ?? "";
  }

  if (!phone) {
    throw new StartFromRecordError(
      "NO_PHONE",
      "This lead has no phone number on the linked person."
    );
  }

  const waId = normalizeWaPhone(phone);

  // Pick the WhatsApp channel account for this operating company.
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.operatingCompanyRecordId, operatingCompanyRecordId),
        eq(channelAccounts.isActive, true)
      )
    )
    .limit(1);
  if (!account) {
    throw new StartFromRecordError(
      "NO_WHATSAPP_ACCOUNT",
      "No active WhatsApp channel account for this operating company."
    );
  }

  // Find existing conversation. Priority: already linked to this deal;
  // fallback: same phone on the same channel account.
  let [existing] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.channelAccountId, account.id),
        eq(inboxConversations.dealRecordId, recordId)
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);

  if (!existing) {
    [existing] = await db
      .select()
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.workspaceId, workspaceId),
          eq(inboxConversations.channelAccountId, account.id),
          eq(inboxConversations.externalThreadId, waId)
        )
      )
      .orderBy(desc(inboxConversations.lastMessageAt))
      .limit(1);
  }

  if (existing) {
    // Back-fill the deal link if missing so future lookups are O(1).
    if (!existing.dealRecordId) {
      await db
        .update(inboxConversations)
        .set({ dealRecordId: recordId, updatedAt: new Date() })
        .where(eq(inboxConversations.id, existing.id));
    }
    return { mode: "open", conversationId: existing.id };
  }

  return {
    mode: "compose",
    channelAccountId: account.id,
    toPhone: phone,
    customerName,
    dealRecordId: recordId,
  };
}

// ─── Templates (Meta-approved message templates) ─────────────────────────────
// Templates are the only way to open a conversation from the business side or
// reply after the 24h customer-service window expires. They're created and
// approved inside Meta Business Suite; we fetch them live from the Graph API
// per channel account — no caching, so what you see in the CRM always matches
// Meta's source of truth.

export interface WhatsAppTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  text?: string;
  format?: string;
  example?: unknown;
  buttons?: Array<{ type: string; text: string }>;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "DISABLED" | "PAUSED";
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  components: WhatsAppTemplateComponent[];
  /** Number of `{{n}}` placeholders in the BODY component. */
  bodyVariableCount: number;
}

/** Count `{{1}}`, `{{2}}` … placeholders in a template body string. */
function countBodyVariables(text: string | undefined): number {
  if (!text) return 0;
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches).size : 0;
}

/** Fetch all message templates for a channel account's WABA, live from Meta. */
export async function fetchWhatsAppTemplates(
  channelAccountId: string,
  workspaceId: string
): Promise<WhatsAppTemplate[]> {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, channelAccountId),
        eq(channelAccounts.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (!account.wabaId || !account.credential) {
    throw new Error("Channel account missing WABA id or access token");
  }

  const url =
    `${GRAPH_API_BASE}/${account.wabaId}/message_templates` +
    `?fields=name,language,status,category,components&limit=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.credential}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<Omit<WhatsAppTemplate, "bodyVariableCount">>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      `Failed to fetch templates: ${json.error?.message ?? res.status}`
    );
  }

  return (json.data ?? []).map((t) => {
    const body = t.components?.find((c) => c.type === "BODY");
    return { ...t, bodyVariableCount: countBodyVariables(body?.text) };
  });
}

/** Strip non-digits from a phone number. Meta expects digits-only E.164. */
export function normalizeWaPhone(input: string): string {
  const digits = input.replace(/\D+/g, "");
  if (digits.length < 7) throw new Error("Invalid phone number");
  return digits;
}

export async function sendWhatsAppTemplate(params: {
  workspaceId: string;
  channelAccountId: string;
  toPhone: string;
  customerName: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
  /** Optional deal/lead to link this conversation to. Set on create and
   *  back-filled onto existing conversations that don't yet have a link. */
  dealRecordId?: string | null;
}) {
  const {
    workspaceId,
    channelAccountId,
    toPhone,
    customerName,
    templateName,
    languageCode,
    bodyParams,
    dealRecordId,
  } = params;

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, channelAccountId),
        eq(channelAccounts.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (!account.waPhoneNumberId || !account.credential) {
    throw new Error("Channel account missing phone number ID or access token");
  }

  const waId = normalizeWaPhone(toPhone);

  // Look up the template's components so we know whether it has a media
  // header. Meta requires every component defined in the approved template
  // to be included at send time — omitting a header image yields #132012.
  const templateUrl =
    `${GRAPH_API_BASE}/${account.wabaId}/message_templates` +
    `?fields=name,language,components&limit=200`;
  const tplRes = await fetch(templateUrl, {
    headers: { Authorization: `Bearer ${account.credential}` },
  });
  const tplJson = (await tplRes.json().catch(() => ({}))) as {
    data?: Array<{
      name: string;
      language: string;
      components: WhatsAppTemplateComponent[];
    }>;
  };
  const tpl = tplJson.data?.find(
    (t) => t.name === templateName && t.language === languageCode
  );
  const headerComp = tpl?.components.find((c) => c.type === "HEADER");
  const headerFormat = headerComp?.format?.toUpperCase();
  const needsMediaHeader =
    headerFormat === "IMAGE" ||
    headerFormat === "VIDEO" ||
    headerFormat === "DOCUMENT";

  let headerImageUrl: string | null = null;
  if (needsMediaHeader) {
    const [metaRow] = await db
      .select()
      .from(whatsappTemplateMetadata)
      .where(
        and(
          eq(whatsappTemplateMetadata.workspaceId, workspaceId),
          eq(whatsappTemplateMetadata.wabaId, account.wabaId!),
          eq(whatsappTemplateMetadata.templateName, templateName),
          eq(whatsappTemplateMetadata.languageCode, languageCode)
        )
      )
      .limit(1);
    headerImageUrl = metaRow?.headerImageUrl ?? null;
    if (!headerImageUrl) {
      throw new Error(
        `Template "${templateName}" has a ${headerFormat} header. ` +
          `Please set the header media URL for this template in the ` +
          `compose dialog (it's saved per template and reused on every send).`
      );
    }
    if (headerFormat !== "IMAGE") {
      throw new Error(
        `Template "${templateName}" uses a ${headerFormat} header, which ` +
          `is not yet supported by the CRM. Only IMAGE headers are wired up.`
      );
    }
  }

  // Upsert contact + conversation up-front so the message has somewhere to
  // land even if Meta's response is slow. We mirror the email thread-key
  // behaviour: (channelAccountId, waId) uniquely identifies a conversation.
  const contact = await upsertContact(workspaceId, waId, customerName);

  // Auto-create CRM Person for the contact (idempotent).
  await ensureCrmPerson({
    workspaceId,
    contactId: contact.id,
    displayName: customerName || waId,
    email: null,
    phone: waId,
    leadSource: "WhatsApp / Website",
  });

  const threadKey = waId;
  let [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.channelAccountId, account.id),
        eq(inboxConversations.externalThreadId, threadKey)
      )
    )
    .limit(1);

  let createdNewConversation = false;
  if (!conv) {
    const [created] = await db
      .insert(inboxConversations)
      .values({
        workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: threadKey,
        subject: null,
        lastMessageAt: new Date(),
        lastMessagePreview: `Du: [Template] ${templateName}`,
        unreadCount: 0,
        dealRecordId: dealRecordId ?? null,
      })
      .returning();
    conv = created;
    createdNewConversation = true;
  } else if (dealRecordId && !conv.dealRecordId) {
    // Back-fill link on an existing conversation that isn't yet tied to a
    // deal. Never overwrite an existing link.
    await db
      .update(inboxConversations)
      .set({ dealRecordId, updatedAt: new Date() })
      .where(eq(inboxConversations.id, conv.id));
    conv = { ...conv, dealRecordId };
  }

  // Call Meta. Templates bypass the 24h window — that's their whole point.
  const res = await fetch(
    `${GRAPH_API_BASE}/${account.waPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: waId,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            ...(headerImageUrl
              ? [
                  {
                    type: "header",
                    parameters: [
                      { type: "image", image: { link: headerImageUrl } },
                    ],
                  },
                ]
              : []),
            ...(bodyParams.length > 0
              ? [
                  {
                    type: "body",
                    parameters: bodyParams.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ]
              : []),
          ],
        },
      }),
    }
  );

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    // Roll back the empty conversation if this was a first-contact attempt,
    // so the inbox doesn't fill with failed shells.
    if (createdNewConversation) {
      await db
        .delete(inboxConversations)
        .where(eq(inboxConversations.id, conv.id));
    }
    throw new Error(
      `WhatsApp template send failed: ${json.error?.message ?? `Meta ${res.status}`}`
    );
  }

  const externalId = json.messages?.[0]?.id ?? null;

  // Render a local preview of what the customer will see so the inbox timeline
  // has something readable, not just "[Template]".
  const bodyText = await renderTemplatePreview(
    account,
    templateName,
    languageCode,
    bodyParams
  );

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId: conv.id,
      direction: "outbound",
      status: "sent",
      externalMessageId: externalId,
      fromAddress: account.waPhoneNumberId,
      toAddress: waId,
      subject: null,
      body: bodyText,
      isRead: true,
      rawHeaders: JSON.stringify({
        kind: "template",
        templateName,
        languageCode,
        bodyParams,
      }),
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${bodyText.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conv.id));

  if (createdNewConversation) {
    await createDealForNewConversation({
      workspaceId,
      conversationId: conv.id,
      dealName: customerName || waId,
      contactId: contact.id,
      channelAccountId: account.id,
    });
  }

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId: conv.id,
        channelType: "whatsapp",
        toAddress: waId,
        externalMessageId: externalId,
        templateName,
      },
    });
  }

  return { message: stored, conversationId: conv.id, createdNewConversation };
}

/**
 * Substitute `{{1}}`, `{{2}}` … placeholders in a template's BODY text so the
 * inbox can display the rendered message instead of the raw template name.
 * Failures (template removed, Meta down) degrade to a generic placeholder.
 */
async function renderTemplatePreview(
  account: typeof channelAccounts.$inferSelect,
  templateName: string,
  languageCode: string,
  params: string[]
): Promise<string> {
  try {
    if (!account.wabaId || !account.credential) return `[Template: ${templateName}]`;
    const res = await fetch(
      `${GRAPH_API_BASE}/${account.wabaId}/message_templates` +
        `?fields=name,language,components&limit=200`,
      { headers: { Authorization: `Bearer ${account.credential}` } }
    );
    if (!res.ok) return `[Template: ${templateName}]`;
    const json = (await res.json()) as {
      data?: Array<{ name: string; language: string; components: WhatsAppTemplateComponent[] }>;
    };
    const tpl = json.data?.find(
      (t) => t.name === templateName && t.language === languageCode
    );
    const body = tpl?.components.find((c) => c.type === "BODY")?.text ?? "";
    if (!body) return `[Template: ${templateName}]`;
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
      const idx = Number(n) - 1;
      return params[idx] ?? `{{${n}}}`;
    });
  } catch {
    return `[Template: ${templateName}]`;
  }
}

// ─── Template metadata (variable labels) ─────────────────────────────────────
// Labels are scoped per WABA, not per channel account, so re-creating a
// channel account doesn't lose them.

export interface TemplateMetadataRow {
  templateName: string;
  languageCode: string;
  variableLabels: Record<string, string>;
  headerImageUrl: string | null;
}

async function requireChannelAccountWaba(
  channelAccountId: string,
  workspaceId: string
) {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, channelAccountId),
        eq(channelAccounts.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (!account.wabaId) throw new Error("Channel account missing WABA id");
  return account;
}

/** Return all template metadata rows for the WABA behind this channel account. */
export async function getTemplateMetadataForAccount(
  channelAccountId: string,
  workspaceId: string
): Promise<TemplateMetadataRow[]> {
  const account = await requireChannelAccountWaba(channelAccountId, workspaceId);
  const rows = await db
    .select()
    .from(whatsappTemplateMetadata)
    .where(
      and(
        eq(whatsappTemplateMetadata.workspaceId, workspaceId),
        eq(whatsappTemplateMetadata.wabaId, account.wabaId!)
      )
    );
  return rows.map((r) => ({
    templateName: r.templateName,
    languageCode: r.languageCode,
    variableLabels: r.variableLabels,
    headerImageUrl: r.headerImageUrl ?? null,
  }));
}

/**
 * Partial upsert. Pass only the fields you want to change — undefined means
 * "leave alone", null on headerImageUrl means "clear". Empty object on
 * variableLabels replaces the existing labels (intentional — that's how the
 * UI deletes a label).
 */
export async function upsertTemplateMetadata(params: {
  channelAccountId: string;
  workspaceId: string;
  templateName: string;
  languageCode: string;
  variableLabels?: Record<string, string>;
  headerImageUrl?: string | null;
}) {
  const account = await requireChannelAccountWaba(
    params.channelAccountId,
    params.workspaceId
  );
  const updateSet: {
    variableLabels?: Record<string, string>;
    headerImageUrl?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (params.variableLabels !== undefined) {
    updateSet.variableLabels = params.variableLabels;
  }
  if (params.headerImageUrl !== undefined) {
    updateSet.headerImageUrl = params.headerImageUrl;
  }
  await db
    .insert(whatsappTemplateMetadata)
    .values({
      workspaceId: params.workspaceId,
      wabaId: account.wabaId!,
      templateName: params.templateName,
      languageCode: params.languageCode,
      variableLabels: params.variableLabels ?? {},
      headerImageUrl: params.headerImageUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [
        whatsappTemplateMetadata.workspaceId,
        whatsappTemplateMetadata.wabaId,
        whatsappTemplateMetadata.templateName,
        whatsappTemplateMetadata.languageCode,
      ],
      set: updateSet,
    });
}

/** @deprecated Use `upsertTemplateMetadata` instead. Kept for callers that
 *  only touch variable labels. */
export async function setTemplateLabels(params: {
  channelAccountId: string;
  workspaceId: string;
  templateName: string;
  languageCode: string;
  variableLabels: Record<string, string>;
}) {
  await upsertTemplateMetadata(params);
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getAppSecret(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_APP_SECRET_KEY);
}

export async function getVerifyToken(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_VERIFY_TOKEN_KEY);
}
