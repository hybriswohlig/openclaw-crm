-- Kontaktart on the conversation and on the person, plus the deal outcome
-- "Kein Lead". Additive and idempotent. Does not rewrite existing deals.
-- Unset conversation rows read as lead_kunde via the column default.

ALTER TABLE "inbox_conversations"
  ADD COLUMN IF NOT EXISTS "kontaktart" text DEFAULT 'lead_kunde' NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "inbox_conversations"
    ADD CONSTRAINT "inbox_conversations_kontaktart_check"
    CHECK ("kontaktart" IN (
      'lead_kunde',
      'bewerber',
      'team_helfer',
      'partner_vermittler',
      'privat',
      'spam_werbung'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_conv_kontaktart_idx"
  ON "inbox_conversations" ("workspace_id", "kontaktart");
--> statement-breakpoint
INSERT INTO "attributes" (
  "id", "object_id", "slug", "title", "type", "config",
  "is_system", "is_required", "is_unique", "is_multiselect", "sort_order"
)
SELECT
  gen_random_uuid()::text,
  o.id,
  'kontaktart',
  'Kontaktart',
  'select'::attribute_type,
  '{}'::jsonb,
  true,
  false,
  false,
  false,
  20
FROM "objects" o
WHERE o.slug = 'people'
  AND NOT EXISTS (
    SELECT 1 FROM "attributes" a
    WHERE a.object_id = o.id AND a.slug = 'kontaktart'
  );
--> statement-breakpoint
INSERT INTO "select_options" ("id", "attribute_id", "title", "color", "sort_order")
SELECT gen_random_uuid()::text, a.id, v.title, v.color, v.sort_order
FROM "attributes" a
JOIN "objects" o ON o.id = a.object_id
CROSS JOIN (
  VALUES
    ('Lead/Kunde', '#16a34a', 0),
    ('Bewerber', '#2563eb', 1),
    ('Team/Helfer', '#0ea5e9', 2),
    ('Partner/Vermittler', '#7c3aed', 3),
    ('Privat', '#d97706', 4),
    ('Spam/Werbung', '#64748b', 5)
) AS v(title, color, sort_order)
WHERE o.slug = 'people'
  AND a.slug = 'kontaktart'
  AND NOT EXISTS (
    SELECT 1 FROM "select_options" s
    WHERE s.attribute_id = a.id AND lower(s.title) = lower(v.title)
  );
--> statement-breakpoint
INSERT INTO "statuses" (
  "id", "attribute_id", "title", "color", "sort_order",
  "is_active", "celebration_enabled", "stage_category", "is_terminal"
)
SELECT
  gen_random_uuid()::text,
  a.id,
  'Kein Lead',
  '#94a3b8',
  80,
  true,
  false,
  'kein_lead',
  true
FROM "attributes" a
JOIN "objects" o ON o.id = a.object_id
WHERE o.slug = 'deals'
  AND a.slug = 'stage'
  AND NOT EXISTS (
    SELECT 1 FROM "statuses" s
    WHERE s.attribute_id = a.id
      AND (s.stage_category = 'kein_lead' OR lower(s.title) = 'kein lead')
  );
