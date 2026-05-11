-- Baileys (personal-WhatsApp linked-device) columns on channel_accounts.
-- Adds bridge selector + pairing lifecycle state for the in-house Baileys
-- bridge. Auth state itself lives encrypted in workspace_settings under
-- key `baileys.auth_state.<channel_account_id>` and is NOT a column here.
--
-- All columns are nullable / defaulted so existing rows remain valid:
--   - WABA accounts (wa_phone_number_id IS NOT NULL) ignore these fields
--   - Legacy Baileys rows fed by OpenClaw default to provider='openclaw'
--   - New in-house Baileys rows are created with provider='inhouse'

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_bridge_provider" text DEFAULT 'openclaw';

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_pairing_status" text DEFAULT 'idle';

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_qr_payload" text;

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_qr_updated_at" timestamp;

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_pairing_code" text;

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_own_jid" text;

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_last_seen_at" timestamp;

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "baileys_last_disconnect_reason" text;
