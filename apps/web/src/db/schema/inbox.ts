import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("inbox_messages_conversation_idx").on(table.conversationId),
    index("inbox_messages_workspace_idx").on(table.workspaceId),
    index("inbox_messages_external_id_idx").on(table.externalMessageId),
    index("inbox_messages_is_read_idx").on(table.isRead),
    index("inbox_messages_sent_at_idx").on(table.sentAt),
  ]
);
