-- WhatsApp Business (Meta Cloud API) integration.
-- Adds a display phone number to channel_accounts, a routing index on
-- wa_phone_number_id, and a partial unique index on inbox_messages.external_message_id
-- scoped per conversation so webhook replays are idempotent.

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "wa_display_phone_number" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "channel_accounts_wa_phone_number_id_idx"
  ON "channel_accounts" ("wa_phone_number_id")
  WHERE "wa_phone_number_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_messages_conv_external_id_uniq"
  ON "inbox_messages" ("conversation_id", "external_message_id")
  WHERE "external_message_id" IS NOT NULL;
