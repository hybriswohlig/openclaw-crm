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
  whatsappTemplateMetadata,
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
}) {
  const {
    workspaceId,
    channelAccountId,
    toPhone,
    customerName,
    templateName,
    languageCode,
    bodyParams,
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

  // Upsert contact + conversation up-front so the message has somewhere to
  // land even if Meta's response is slow. We mirror the email thread-key
  // behaviour: (channelAccountId, waId) uniquely identifies a conversation.
  const contact = await upsertContact(workspaceId, waId, customerName);

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
      })
      .returning();
    conv = created;
    createdNewConversation = true;
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
          components:
            bodyParams.length > 0
              ? [
                  {
                    type: "body",
                    parameters: bodyParams.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ]
              : [],
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
  }));
}

export async function setTemplateLabels(params: {
  channelAccountId: string;
  workspaceId: string;
  templateName: string;
  languageCode: string;
  variableLabels: Record<string, string>;
}) {
  const account = await requireChannelAccountWaba(
    params.channelAccountId,
    params.workspaceId
  );
  await db
    .insert(whatsappTemplateMetadata)
    .values({
      workspaceId: params.workspaceId,
      wabaId: account.wabaId!,
      templateName: params.templateName,
      languageCode: params.languageCode,
      variableLabels: params.variableLabels,
    })
    .onConflictDoUpdate({
      target: [
        whatsappTemplateMetadata.workspaceId,
        whatsappTemplateMetadata.wabaId,
        whatsappTemplateMetadata.templateName,
        whatsappTemplateMetadata.languageCode,
      ],
      set: {
        variableLabels: params.variableLabels,
        updatedAt: new Date(),
      },
    });
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getAppSecret(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_APP_SECRET_KEY);
}

export async function getVerifyToken(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_VERIFY_TOKEN_KEY);
}
