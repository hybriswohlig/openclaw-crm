import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const channelTypeEnum = pgEnum("channel_type", [
  "email",
  "whatsapp",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",    // outbound: queued, not yet sent
  "sent",       // outbound: accepted by provider
  "delivered",  // outbound: confirmed delivered (WhatsApp)
  "failed",     // outbound: delivery failed
  "received",   // inbound: arrived in inbox
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "resolved",
  "spam",
]);

// ─── Channel Accounts ─────────────────────────────────────────────────────────
// One row per email address / WhatsApp number per operating company.
// These are created via Settings → Integrations → Channel Accounts.

export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Reference to the operating_companies record (generic records table)
    operatingCompanyRecordId: text("operating_company_record_id")
      .references(() => records.id, { onDelete: "set null" }),
    channelType: channelTypeEnum("channel_type").notNull(),
    // Display name shown in the inbox filter bar
    name: text("name").notNull(),
    // For email: the gmail address. For WhatsApp: the phone number (E.164)
    address: text("address").notNull(),
    // For email: Gmail App Password. For WhatsApp: API bearer token.
    // Stored plaintext for now — encrypt at rest in a future iteration.
    credential: text("credential"),
    // IMAP/SMTP host (email) or API base URL (WhatsApp)
    imapHost: text("imap_host"),
    smtpHost: text("smtp_host"),
    // WhatsApp Business Account ID / Phone number ID (Meta API)
    wabaId: text("waba_id"),
    waPhoneNumberId: text("wa_phone_number_id"),
    // Human-readable display number (e.g. "+49 30 12345678") used in the UI.
    waDisplayPhoneNumber: text("wa_display_phone_number"),
    isActive: boolean("is_active").notNull().default(true),
    // Stores the last IMAP UID seen so polling only fetches new mail
    lastSyncUid: integer("last_sync_uid").default(0),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("channel_accounts_workspace_idx").on(table.workspaceId),
    index("channel_accounts_op_company_idx").on(table.operatingCompanyRecordId),
    index("channel_accounts_wa_phone_number_id_idx").on(table.waPhoneNumberId),
    uniqueIndex("channel_accounts_workspace_address_idx").on(
      table.workspaceId,
      table.address
    ),
  ]
);

// ─── Contacts ─────────────────────────────────────────────────────────────────
// External people who reach out via inbox channels.
// Linked to a CRM people/companies record when matched or manually merged.

export const inboxContacts = pgTable(
  "inbox_contacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // CRM record link (people object) — set when matched or manually linked
    crmRecordId: text("crm_record_id")
      .references(() => records.id, { onDelete: "set null" }),
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    // Cross-company contact flag: set true when the same person has conversations
    // with more than one of our operating companies
    multiCompanyFlag: boolean("multi_company_flag").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("inbox_contacts_workspace_idx").on(table.workspaceId),
    index("inbox_contacts_email_idx").on(table.email),
    index("inbox_contacts_phone_idx").on(table.phone),
    index("inbox_contacts_crm_idx").on(table.crmRecordId),
  ]
);

// ─── Conversations ────────────────────────────────────────────────────────────
// A thread between one contact and one channel account.
// One contact can have multiple conversations (one per channel account).

export const inboxConversations = pgTable(
  "inbox_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelAccountId: text("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => inboxContacts.id, { onDelete: "cascade" }),
    // Channel-specific thread identifier:
    // email → the "thread" key (In-Reply-To chain or Kleinanzeigen relay address)
    // whatsapp → the wa_id (phone number in E.164)
    externalThreadId: text("external_thread_id"),
    subject: text("subject"), // email subject line
    status: conversationStatusEnum("status").notNull().default("open"),
    // Snippet of the latest message for the conversation list preview
    lastMessageAt: timestamp("last_message_at"),
    lastMessagePreview: text("last_message_preview"),
    unreadCount: integer("unread_count").notNull().default(0),
    // Optional: link this conversation to a CRM deal
    dealRecordId: text("deal_record_id")
      .references(() => records.id, { onDelete: "set null" }),
    // Lead-assistant debounce state. The AI worker watches conversations
    // where aiNeedsReply=true and (now - aiLastInboundAt) >= aiQuietWindowSeconds,
    // bundles all unprocessed inbound messages, and replies once. Manual
    // operator replies clear aiNeedsReply via the send pipeline. aiPaused is
    // a per-lead kill switch to take a conversation out of AI handling.
    aiNeedsReply: boolean("ai_needs_reply").notNull().default(false),
    aiLastInboundAt: timestamp("ai_last_inbound_at"),
    aiQuietWindowSeconds: integer("ai_quiet_window_seconds").notNull().default(160),
    aiPaused: boolean("ai_paused").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("inbox_conv_workspace_idx").on(table.workspaceId),
    index("inbox_conv_channel_idx").on(table.channelAccountId),
    index("inbox_conv_contact_idx").on(table.contactId),
    index("inbox_conv_status_idx").on(table.status),
    index("inbox_conv_last_msg_idx").on(table.lastMessageAt),
    index("inbox_conv_deal_idx").on(table.dealRecordId),
    uniqueIndex("inbox_conv_channel_thread_idx").on(
      table.channelAccountId,
      table.externalThreadId
    ),
  ]
);

// ─── Messages ─────────────────────────────────────────────────────────────────
// Individual messages within a conversation.

export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    status: messageStatusEnum("status").notNull().default("received"),
    // Raw provider message ID (email Message-ID header, WhatsApp wamid)
    externalMessageId: text("external_message_id"),
    // For email: the From/To address. For WhatsApp: the phone number.
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    subject: text("subject"),
    // Plain-text body (stripped HTML for email)
    body: text("body").notNull().default(""),
    // Original HTML body (email only)
    bodyHtml: text("body_html"),
    isRead: boolean("is_read").notNull().default(false),
    // Raw email headers JSON (for threading / debugging)
    rawHeaders: text("raw_headers"),
    sentAt: timestamp("sent_at"),
    // Set when the lead-assistant has consumed this inbound message (either
    // by replying, or by deciding to skip — in which case aiSkipReason
    // explains why: 'human_replied_first', 'spam', 'out_of_scope', etc.).
    aiProcessedAt: timestamp("ai_processed_at"),
    aiSkipReason: text("ai_skip_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("inbox_messages_conversation_idx").on(table.conversationId),
    index("inbox_messages_workspace_idx").on(table.workspaceId),
    index("inbox_messages_external_id_idx").on(table.externalMessageId),
    index("inbox_messages_is_read_idx").on(table.isRead),
    index("inbox_messages_sent_at_idx").on(table.sentAt),
    uniqueIndex("inbox_messages_conv_external_id_uniq").on(
      table.conversationId,
      table.externalMessageId
    ),
  ]
);

// ─── Message attachments ──────────────────────────────────────────────────────
// Binary attachments that arrive with an inbound message (images, PDFs, voice
// notes, etc.). Stored as base64 in a TEXT column to keep the storage path the
// same as `deal_documents` — no new bucket or blob provider needed.
//
// `dealRecordId` is duplicated from the parent conversation at insert time so
// the lead view can list all files the customer has ever sent in O(1) without
// joining through conversations.

export const inboxMessageAttachments = pgTable(
  "inbox_message_attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => inboxMessages.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    // Snapshot of the conversation's linked deal at the time the attachment
    // arrived. Set to null if the conversation is not yet linked; back-filled
    // later when a deal is created.
    dealRecordId: text("deal_record_id")
      .references(() => records.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileContent: text("file_content").notNull(), // base64
    // The channel-native media id (WhatsApp media_id or email Content-ID), kept
    // so we can deduplicate if the same payload is replayed.
    externalMediaId: text("external_media_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("inbox_attachments_message_idx").on(table.messageId),
    index("inbox_attachments_conversation_idx").on(table.conversationId),
    index("inbox_attachments_deal_idx").on(table.dealRecordId),
    index("inbox_attachments_workspace_idx").on(table.workspaceId),
  ]
);

// ─── WhatsApp template metadata ───────────────────────────────────────────────
// Per-template variable labels so the compose UI can show "Kundenvorname"
// instead of "{{1}}". Meta doesn't expose variable semantics, so we persist
// them on our side, keyed by WABA + template name + language.

export const whatsappTemplateMetadata = pgTable(
  "whatsapp_template_metadata",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    templateName: text("template_name").notNull(),
    languageCode: text("language_code").notNull(),
    variableLabels: jsonb("variable_labels")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // Public URL for templates whose HEADER component is of format IMAGE.
    // Meta requires the URL to be sent with every send; we persist it per
    // template so the user sets it once, not on every compose.
    headerImageUrl: text("header_image_url"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.wabaId,
        table.templateName,
        table.languageCode,
      ],
    }),
  ]
);
