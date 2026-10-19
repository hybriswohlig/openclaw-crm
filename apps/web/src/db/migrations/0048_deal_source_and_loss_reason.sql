-- Deal Quelle / Kanal and Verlustgrund.
-- Dedicated deal attributes. People and companies keep their own lead_source
-- option list; these slugs are not that field.
-- is_required stays false: the operator create form enforces Quelle, while
-- API, MCP, and inbound automations may omit it.
-- Idempotent: existing slugs and option titles are left untouched.

INSERT INTO "attributes" (
  "id", "object_id", "slug", "title", "type", "config",
  "is_system", "is_required", "is_unique", "is_multiselect", "sort_order"
)
SELECT
  gen_random_uuid()::text,
  o.id,
  v.slug,
  v.title,
  v.type::attribute_type,
  '{}'::jsonb,
  true,
  false,
  false,
  false,
  v.sort_order
FROM "objects" o
CROSS JOIN (
  VALUES
    ('source_channel', 'Quelle / Kanal', 'select', 100),
    ('source_detail', 'Anzeige / Detail', 'text', 101),
    ('source_received_at', 'Eingegangen am', 'timestamp', 102),
    ('first_reply_at', 'Erste Antwort', 'timestamp', 103),
    ('loss_reason', 'Verlustgrund', 'select', 104),
    ('loss_reason_note', 'Verlustgrund (Freitext)', 'text', 105)
) AS v(slug, title, type, sort_order)
WHERE o.slug = 'deals'
  AND NOT EXISTS (
    SELECT 1 FROM "attributes" a
    WHERE a.object_id = o.id AND a.slug = v.slug
  );
--> statement-breakpoint
INSERT INTO "select_options" ("id", "attribute_id", "title", "color", "sort_order")
SELECT gen_random_uuid()::text, a.id, v.title, v.color, v.sort_order
FROM "attributes" a
JOIN "objects" o ON o.id = a.object_id
CROSS JOIN (
  VALUES
    ('source_channel', 'Website-Formular', '#0ea5e9', 0),
    ('source_channel', 'WhatsApp', '#16a34a', 1),
    ('source_channel', 'Telefon', '#6366f1', 2),
    ('source_channel', 'Google-Profil (GBP)', '#2563eb', 3),
    ('source_channel', 'ImmoScout24 / umzugsfirmen-check', '#f97316', 4),
    ('source_channel', 'Kleinanzeigen', '#ca8a04', 5),
    ('source_channel', 'Empfehlung', '#7c3aed', 6),
    ('source_channel', 'Sonstiges', '#6b7280', 7),
    ('loss_reason', 'zu teuer', '#dc2626', 0),
    ('loss_reason', 'anderer Anbieter', '#ea580c', 1),
    ('loss_reason', 'Selbstumzug', '#d97706', 2),
    ('loss_reason', 'Termin passt nicht', '#ca8a04', 3),
    ('loss_reason', 'keine Rückmeldung', '#6b7280', 4),
    ('loss_reason', 'Umzug abgesagt', '#7c3aed', 5),
    ('loss_reason', 'Sonstiges', '#64748b', 6)
) AS v(attr_slug, title, color, sort_order)
WHERE o.slug = 'deals'
  AND a.slug = v.attr_slug
  AND NOT EXISTS (
    SELECT 1 FROM "select_options" s
    WHERE s.attribute_id = a.id AND lower(s.title) = lower(v.title)
  );
