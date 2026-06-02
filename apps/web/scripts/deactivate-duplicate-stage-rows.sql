-- One-off data migration (Block 6c of the KI Summary rework).
--
-- The deals.stage attribute carries TWO overlapping vocabularies: the active
-- German stages that real deals use (Neue Anfrage … Verloren) AND the original
-- English seed rows (Inquiry … Lost) plus two "(merged)" leftovers, with
-- COLLIDING sort_order values (both 0..5). Deals sit only on the German rows;
-- the English/"(merged)" rows are unused clutter and make the sort_order-based
-- forward-stage gate fragile.
--
-- This script DEACTIVATES (is_active = false) — never DELETES — the unused
-- English + "(merged)" rows that have ZERO deals referencing them. It is
-- idempotent and referentially safe (no row is removed, so no record_value can
-- be orphaned). The application code already matches stages by normalized title
-- and uses each deal's current stage for the forward gate, so this is cleanup,
-- not a correctness fix.
--
-- RUN ORDER:
--   1. Take a fresh DB backup (pg_dump) first.
--   2. Run the SELECT (step 1) and eyeball the rows + deals_on_stage counts.
--   3. Run the UPDATE (step 2) only if every targeted row shows deals_on_stage = 0.

-- ── Step 1: inspect (read-only) ───────────────────────────────────────────────
SELECT
  s.id,
  s.title,
  s.sort_order,
  s.is_active,
  (
    SELECT count(*)
    FROM record_values rv
    WHERE rv.attribute_id = s.attribute_id AND rv.text_value = s.id
  ) AS deals_on_stage
FROM statuses s
JOIN attributes a ON a.id = s.attribute_id
JOIN objects o ON o.id = a.object_id
WHERE o.slug = 'deals' AND a.slug = 'stage'
ORDER BY s.sort_order, s.title;

-- ── Step 2: deactivate the unused English + "(merged)" duplicates ─────────────
UPDATE statuses s
SET is_active = false
FROM attributes a
JOIN objects o ON o.id = a.object_id
WHERE s.attribute_id = a.id
  AND o.slug = 'deals'
  AND a.slug = 'stage'
  AND (
    lower(s.title) IN ('inquiry', 'contacted', 'information gathered', 'quoted', 'planned', 'done', 'paid', 'lost')
    OR s.title ILIKE '%(merged)%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM record_values rv
    WHERE rv.attribute_id = s.attribute_id AND rv.text_value = s.id
  );
