-- ─── Gmail API transport for channel_accounts ────────────────────────────────
-- Additive only. Adds a transport discriminator + Gmail incremental-sync cursor
-- so Google Workspace mailboxes (kontakt@kottke-umzuege.de, info@ceylan-
-- operations.de) can receive and send via the Gmail REST API alongside the
-- existing IMAP/SMTP App-Password accounts. channel_type stays 'email' for both;
-- only syncChannelAccount (receive) and sendEmailReply (send) branch on
-- email_provider. Existing rows default to 'imap_smtp' so nothing changes for them.

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "email_provider" text DEFAULT 'imap_smtp';

-- Gmail users.history.list cursor (startHistoryId). NULL until first connect;
-- expires after ~1 week → full-sync fallback re-seeds it.
ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "last_sync_history_id" text;

-- Phase 2 (Pub/Sub push) watch expiry. Unused while polling.
ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "watch_expires_at" timestamp;
