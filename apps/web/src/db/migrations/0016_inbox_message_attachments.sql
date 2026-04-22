-- Inbox message attachments: binary content (images, PDFs, voice notes, ...)
-- that arrive alongside an inbound message. Stored as base64 in a TEXT column
-- so we stay on the same storage path as `deal_documents` (no new bucket).
--
-- deal_record_id is snapshotted from the parent conversation at insert time
-- so the lead view can list everything the customer has sent in O(1) without
-- joining through conversations.

CREATE TABLE IF NOT EXISTS "inbox_message_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "message_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "deal_record_id" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "file_content" text NOT NULL,
  "external_media_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inbox_message_attachments_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "inbox_message_attachments_message_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "public"."inbox_messages"("id") ON DELETE cascade,
  CONSTRAINT "inbox_message_attachments_conversation_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade,
  CONSTRAINT "inbox_message_attachments_deal_record_id_fk"
    FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "inbox_attachments_message_idx"
  ON "inbox_message_attachments" ("message_id");
CREATE INDEX IF NOT EXISTS "inbox_attachments_conversation_idx"
  ON "inbox_message_attachments" ("conversation_id");
CREATE INDEX IF NOT EXISTS "inbox_attachments_deal_idx"
  ON "inbox_message_attachments" ("deal_record_id");
CREATE INDEX IF NOT EXISTS "inbox_attachments_workspace_idx"
  ON "inbox_message_attachments" ("workspace_id");
