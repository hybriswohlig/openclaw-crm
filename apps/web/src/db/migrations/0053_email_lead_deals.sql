-- Direct-email deal review and "Deal anlegen" suggestions.
-- Additive. Existing conversations stay null, so nothing is backfilled.
-- Idempotent.

ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "email_deal_state" text;
--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "email_deal_run_after" timestamp;
--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "cross_company_notice" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_conv_email_deal_idx"
  ON "inbox_conversations" ("email_deal_state", "email_deal_run_after");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_deal_suggestions" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "conversation_id" text NOT NULL REFERENCES "inbox_conversations"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "confidence" numeric(4, 3) NOT NULL,
  "reason" text NOT NULL,
  "evidence_quote" text NOT NULL,
  "deal_name" text NOT NULL,
  "source_channel" text NOT NULL,
  "source_detail" text,
  "evidence_key" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "decided_at" timestamp,
  "decided_by" text,
  CONSTRAINT "inbox_deal_suggestions_evidence_unique" UNIQUE ("conversation_id", "evidence_key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_deal_suggestions_pending_idx"
  ON "inbox_deal_suggestions" ("conversation_id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_deal_suggestions_status_idx"
  ON "inbox_deal_suggestions" ("workspace_id", "status", "created_at");
--> statement-breakpoint
UPDATE "select_options" s
SET "sort_order" = 9
FROM "attributes" a
JOIN "objects" o ON o.id = a.object_id
WHERE s.attribute_id = a.id
  AND o.slug = 'deals'
  AND a.slug = 'source_channel'
  AND lower(s.title) = 'sonstiges'
  AND s.sort_order = 7;
--> statement-breakpoint
INSERT INTO "select_options" ("id", "attribute_id", "title", "color", "sort_order")
SELECT gen_random_uuid()::text, a.id, v.title, v.color, v.sort_order
FROM "attributes" a
JOIN "objects" o ON o.id = a.object_id
CROSS JOIN (
  VALUES
    ('E-Mail', '#0284c7', 7),
    ('Möbeltransport24', '#0f766e', 8)
) AS v(title, color, sort_order)
WHERE o.slug = 'deals'
  AND a.slug = 'source_channel'
  AND NOT EXISTS (
    SELECT 1 FROM "select_options" s
    WHERE s.attribute_id = a.id AND lower(s.title) = lower(v.title)
  );
