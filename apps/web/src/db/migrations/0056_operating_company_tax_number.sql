-- Steuernummer on operating companies (Einstellungen → Gesellschaften).
-- The KV/AB/RE renderer prints it in the letterhead only when the field is set.
-- No value is seeded: the number is not a secret to hardcode.
-- Idempotent. 0053/0054 are reserved by other open PRs; 0055 is the letterhead.

INSERT INTO "attributes" (
  "id", "object_id", "slug", "title", "type", "config",
  "is_system", "is_required", "is_unique", "is_multiselect", "sort_order"
)
SELECT
  gen_random_uuid()::text,
  o.id,
  'tax_number',
  'Steuernummer',
  'text'::attribute_type,
  '{}'::jsonb,
  true,
  false,
  false,
  false,
  18
FROM "objects" o
WHERE o.slug = 'operating_companies'
  AND NOT EXISTS (
    SELECT 1 FROM "attributes" a
    WHERE a.object_id = o.id AND a.slug = 'tax_number'
  );
