-- Add 'read' to the message_status enum so customer read receipts (blue
-- checkmarks) survive ingest instead of being collapsed to 'delivered'.
-- Both receipt paths (Baileys bridge -> /baileys-status and the WABA Cloud
-- webhook -> ingestStatus) pass 'read' through once this value exists.
--
-- ALTER TYPE ... ADD VALUE follows the same pattern as 0025_channel_type_sms:
-- it must be the only statement in this file because drizzle-kit migrate
-- wraps each file in its own transaction.

ALTER TYPE "message_status" ADD VALUE IF NOT EXISTS 'read';
