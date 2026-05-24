/**
 * MessageBird (SMS) inbound webhook ingest. Phase 1 of [KOT-603] /
 * [KOT-617]. Lands inbound SMS replies into the same
 * inbox_conversations / inbox_messages tables as WhatsApp and email
 * so the operator UI is one inbox, not three.
 *
 * Server-side only. Outbound SMS lives in
 * `apps/web/src/lib/messaging/providers/messagebird.ts` (PR #16).
 *
 * The downstream complaint scanner ([KOT-623]) reads these inbound
 * rows and decides whether to fire the negative-experience valve;
 * this service stays scope-minimal — it only persists the message.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessages,
} from "@/db/schema/inbox";

// ─── Signature verification ───────────────────────────────────────────────────
// MessageBird's legacy webhook signs the raw body with HMAC-SHA256
// using the dashboard signing key, base64-encoded in the
// `messagebird-signature` header. The newer `messagebird-signature-jwt`
// is also supported by MessageBird in parallel; we use legacy here to
// avoid pulling in a JWT library.

export function verifyMessagebirdSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

// ─── Inbound payload (only fields we read) ────────────────────────────────────

export interface MessagebirdInboundPayload {
  id?: string;
  recipient?: string | number;
  originator?: string;
  body?: string;
  createdDatetime?: string;
}

// ─── Channel-account / contact / conversation upserts ─────────────────────────

async function findOrCreateSmsChannelAccount(workspaceId: string, recipient: string) {
  // recipient is the destination MessageBird virtual number / sender id
  // that the customer replied to. One channel account per (workspace,
  // recipient) so multiple sender IDs (Kottke vs Ceylan) get separate
  // inbox lanes.
  const [existing] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.workspaceId, workspaceId), eq(channelAccounts.address, recipient)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(channelAccounts)
    .values({
      workspaceId,
      channelType: "sms",
      name: `SMS ${recipient}`,
      address: recipient,
      isActive: true,
    })
    .returning();
  return created;
}

async function findOrCreateContact(workspaceId: string, phone: string) {
  const [existing] = await db
    .select()
    .from(inboxContacts)
    .where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.phone, phone)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(inboxContacts)
    .values({ workspaceId, phone, displayName: phone })
    .returning();
  return created;
}

async function findOrCreateConversation(params: {
  workspaceId: string;
  channelAccountId: string;
  contactId: string;
  externalThreadId: string;
}) {
  const [existing] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.channelAccountId, params.channelAccountId),
        eq(inboxConversations.externalThreadId, params.externalThreadId)
      )
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(inboxConversations)
    .values({
      workspaceId: params.workspaceId,
      channelAccountId: params.channelAccountId,
      contactId: params.contactId,
      externalThreadId: params.externalThreadId,
      status: "open",
    })
    .returning();
  return created;
}

// ─── Top-level handler ────────────────────────────────────────────────────────

export interface MessagebirdInboundResult {
  messageId: string;
  conversationId: string;
  contactId: string;
  /** Customer phone in E.164 (originator of the inbound SMS). */
  customerAddress: string;
  body: string;
  sentAt: Date;
}

export async function handleMessagebirdInbound(
  payload: MessagebirdInboundPayload,
  workspaceId: string
): Promise<MessagebirdInboundResult | null> {
  const recipient = payload.recipient != null ? String(payload.recipient) : null;
  const originator = payload.originator?.startsWith("+") ? payload.originator : null;
  const body = payload.body ?? "";
  if (!recipient || !originator) {
    console.warn("[inbox-sms] dropping payload with missing recipient/originator", {
      hasRecipient: !!recipient,
      hasOriginator: !!originator,
    });
    return null;
  }

  const channelAccount = await findOrCreateSmsChannelAccount(workspaceId, recipient);
  const contact = await findOrCreateContact(workspaceId, originator);
  const conversation = await findOrCreateConversation({
    workspaceId,
    channelAccountId: channelAccount.id,
    contactId: contact.id,
    // Customer phone number is the natural thread key for SMS — same
    // shape as WhatsApp, where externalThreadId is the wa_id.
    externalThreadId: originator,
  });

  const sentAt = payload.createdDatetime ? new Date(payload.createdDatetime) : new Date();

  const [message] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId: conversation.id,
      direction: "inbound",
      status: "received",
      externalMessageId: payload.id ?? null,
      fromAddress: originator,
      toAddress: recipient,
      subject: null,
      body,
      isRead: false,
      sentAt,
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: sentAt,
      lastMessagePreview: body.slice(0, 280),
      unreadCount: (conversation.unreadCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversation.id));

  if (!message) return null;
  return {
    messageId: message.id,
    conversationId: conversation.id,
    contactId: contact.id,
    customerAddress: originator,
    body,
    sentAt,
  };
}
