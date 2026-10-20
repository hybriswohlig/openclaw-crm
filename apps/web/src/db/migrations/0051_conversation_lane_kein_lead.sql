-- Lane for contacts that are not customer requests.
-- Must be the only statement in this file: drizzle-kit migrate wraps each
-- file in a transaction, and a new enum value cannot be used until committed.

ALTER TYPE "conversation_lane" ADD VALUE IF NOT EXISTS 'kein_lead';
