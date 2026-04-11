CREATE TABLE IF NOT EXISTS "channel_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "operating_company_record_id" text,
  "channel_type" "channel_type" NOT NULL,
  "name" text NOT NULL,
  "address" text NOT NULL,
  "credential" text,
  "imap_host" text,
  "smtp_host" text,
  "waba_id" text,
  "wa_phone_number_id" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_sync_uid" integer DEFAULT 0,
  "last_sync_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "channel_accounts_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "channel_accounts_op_company_fk"
    FOREIGN KEY ("operating_company_record_id") REFERENCES "public"."records"("id") ON DELETE set null
);

CREATE TABLE IF NOT EXISTS "inbox_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "crm_record_id" text,
  "display_name" text,
  "email" text,
  "phone" text,
  "multi_company_flag" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inbox_contacts_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "inbox_contacts_crm_record_fk"
    FOREIGN KEY ("crm_record_id") REFERENCES "public"."records"("id") ON DELETE set null
);

CREATE TABLE "inbox_conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "channel_account_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "external_thread_id" text,
  "subject" text,
  "status" "conversation_status" NOT NULL DEFAULT 'open',
  "last_message_at" timestamp,
  "last_message_preview" text,
  "unread_count" integer NOT NULL DEFAULT 0,
  "deal_record_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inbox_conversations_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "inbox_conversations_channel_fk"
    FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade,
  CONSTRAINT "inbox_conversations_contact_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."inbox_contacts"("id") ON DELETE cascade,
  CONSTRAINT "inbox_conversations_deal_fk"
    FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE set null
);
CREATE INDEX "inbox_conv_workspace_idx" ON "inbox_conversations" ("workspace_id");
CREATE INDEX "inbox_conv_channel_idx" ON "inbox_conversations" ("channel_account_id");
CREATE INDEX "inbox_conv_contact_idx" ON "inbox_conversations" ("contact_id");
CREATE INDEX "inbox_conv_status_idx" ON "inbox_conversations" ("status");
CREATE INDEX "inbox_conv_last_msg_idx" ON "inbox_conversations" ("last_message_at");
CREATE INDEX "inbox_conv_deal_idx" ON "inbox_conversations" ("deal_record_id");
CREATE UNIQUE INDEX "inbox_conv_channel_thread_idx" ON "inbox_conversations" ("channel_account_id", "external_thread_id");

CREATE TABLE "inbox_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "direction" "message_direction" NOT NULL,
  "status" "message_status" NOT NULL DEFAULT 'received',
  "external_message_id" text,
  "from_address" text,
  "to_address" text,
  "subject" text,
  "body" text NOT NULL DEFAULT '',
  "body_html" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "raw_headers" text,
  "sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inbox_messages_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "inbox_messages_conversation_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade
);
CREATE INDEX "inbox_messages_conversation_idx" ON "inbox_messages" ("conversation_id");
CREATE INDEX "inbox_messages_workspace_idx" ON "inbox_messages" ("workspace_id");
CREATE INDEX "inbox_messages_external_id_idx" ON "inbox_messages" ("external_message_id");
CREATE INDEX "inbox_messages_is_read_idx" ON "inbox_messages" ("is_read");
CREATE INDEX "inbox_messages_sent_at_idx" ON "inbox_messages" ("sent_at");
