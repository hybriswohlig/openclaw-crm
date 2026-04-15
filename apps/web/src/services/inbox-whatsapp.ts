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
} from "@/db/schema/inbox";
import { eq, and } from "drizzle-orm";
import { createDealForNewConversation } from "./inbox";
import { emitEvent } from "./activity-events";
import { getSecret } from "./workspace-settings";

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

function extractMessageBody(msg: WAMessage): { body: string; kind: string } {
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
    case "image":
      return { body: "[Bild]", kind: "image" };
    case "video":
      return { body: "[Video]", kind: "video" };
    case "audio":
      return { body: "[Sprachnachricht]", kind: "audio" };
    case "document":
      return { body: "[Dokument]", kind: "document" };
    case "sticker":
      return { body: "[Sticker]", kind: "sticker" };
    default:
      return { body: `[${msg.type}]`, kind: msg.type };
  }
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
  const { body } = extractMessageBody(msg);
  const sentAt = new Date(Number(msg.timestamp) * 1000);

  const contact = await upsertContact(account.workspaceId, waId, displayName);

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

  const preview = body.slice(0, 120).replace(/\s+/g, " ");

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
  try {
    await db.insert(inboxMessages).values({
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
    });
  } catch (err) {
    // Unique violation → duplicate delivery. Swallow and move on.
    if (err instanceof Error && /duplicate key|unique/i.test(err.message)) return;
    throw err;
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
    .orderBy(inboxMessages.sentAt)
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

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getAppSecret(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_APP_SECRET_KEY);
}

export async function getVerifyToken(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_VERIFY_TOKEN_KEY);
}
