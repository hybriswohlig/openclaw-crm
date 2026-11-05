-- Letterhead fields on operating companies (Einstellungen → Gesellschaften).
-- The KV/AB/RE renderer reads these and falls back to the Kottke defaults
-- when a field is empty. Ceylan rows are not given Kottke values.
-- Idempotent: existing slugs and non-empty values stay as they are.

INSERT INTO "attributes" (
  "id", "object_id", "slug", "title", "type", "config",
  "is_system", "is_required", "is_unique", "is_multiselect", "sort_order"
)
SELECT
  gen_random_uuid()::text,
  o.id,
  v.slug,
  v.title,
  'text'::attribute_type,
  '{}'::jsonb,
  true,
  false,
  false,
  false,
  v.sort_order
FROM "objects" o
CROSS JOIN (
  VALUES
    ('legal_name', 'Name auf Dokumenten', 10),
    ('phone', 'Telefon', 11),
    ('whatsapp', 'WhatsApp', 12),
    ('email', 'E-Mail', 13),
    ('street', 'Straße', 14),
    ('postal_code', 'PLZ', 15),
    ('city', 'Ort', 16),
    ('website', 'Website', 17)
) AS v(slug, title, sort_order)
WHERE o.slug = 'operating_companies'
  AND NOT EXISTS (
    SELECT 1 FROM "attributes" a
    WHERE a.object_id = o.id AND a.slug = v.slug
  );
--> statement-breakpoint
INSERT INTO "record_values" ("id", "record_id", "attribute_id", "text_value", "sort_order")
SELECT
  gen_random_uuid()::text,
  r.id,
  a.id,
  v.text_value,
  0
FROM "records" r
JOIN "objects" o ON o.id = r.object_id AND o.slug = 'operating_companies'
JOIN "record_values" name_rv ON name_rv.record_id = r.id
JOIN "attributes" name_a
  ON name_a.id = name_rv.attribute_id
 AND name_a.object_id = o.id
 AND name_a.slug = 'name'
JOIN "attributes" a ON a.object_id = o.id AND a.slug = v.slug
CROSS JOIN (
  VALUES
    ('legal_name', 'Kottke Entrümpelung & Umzüge'),
    ('phone', '07054 9306962'),
    ('whatsapp', '0151 59058963'),
    ('email', 'kontakt@kottke-umzuege.de'),
    ('street', 'Marktstr. 8'),
    ('postal_code', '72218'),
    ('city', 'Wildberg'),
    ('website', 'https://kottke-umzuege.de')
) AS v(slug, text_value)
WHERE r.deleted_at IS NULL
  AND name_rv.text_value ILIKE '%kottke%'
  AND name_rv.text_value NOT ILIKE '%ceylan%'
  AND NOT EXISTS (
    SELECT 1 FROM "record_values" existing
    WHERE existing.record_id = r.id
      AND existing.attribute_id = a.id
      AND existing.text_value IS NOT NULL
      AND btrim(existing.text_value) <> ''
  );
