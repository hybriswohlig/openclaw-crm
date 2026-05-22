-- Add 'sms' to the channel_type enum so the MessageBird inbound webhook
-- ([KOT-617]) can land messages in inbox_conversations / inbox_messages
-- alongside email and whatsapp threads.
--
-- ALTER TYPE ... ADD VALUE follows the same pattern as 0005_add_json_attribute_type.

ALTER TYPE "channel_type" ADD VALUE IF NOT EXISTS 'sms';
