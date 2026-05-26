-- Reviews engine — `reviews_velocity` reporting view (KOT-621 / KOT-603 §9).
--
-- The HoG reads this weekly to track post-move review-request performance.
-- Phase 1 only — `avg_new_star_rating` stays NULL until the GBP review pull
-- lands (workstream extension).
--
-- Source data:
--   • `review_events` for sends / clicks / complaint-routed and per-event variant
--   • `record_values` + `attributes`/`objects` for the deal-level `brand` select
--     attribute and the `review_request_left_at` timestamp attribute
--   • `select_options` to resolve the `brand` select to its title
--
-- Weeking semantics: ISO week (`date_trunc('week', ...)`) — Monday start. Sends
-- and clicks are bucketed by `review_events.at`; reviews-left are bucketed by
-- the week in which `review_request_left_at` lands. A deal whose send and
-- review-left fall in different weeks therefore contributes to both weeks'
-- rows; `leave_rate` is local to its reporting week, not a cohort metric.
--
-- Empty CRM: returns zero rows, no errors. CREATE OR REPLACE is idempotent
-- as long as the column list / types are unchanged.

CREATE OR REPLACE VIEW "reviews_velocity" AS
WITH
  brand_attrs AS (
    SELECT a.id AS attribute_id
    FROM attributes a
    JOIN objects o ON o.id = a.object_id
    WHERE o.slug = 'deals' AND a.slug = 'brand'
  ),
  left_at_attrs AS (
    SELECT a.id AS attribute_id
    FROM attributes a
    JOIN objects o ON o.id = a.object_id
    WHERE o.slug = 'deals' AND a.slug = 'review_request_left_at'
  ),
  -- Per deal: resolve brand title. The OAV stores `select` attributes in
  -- `text_value`, which the standard UI path fills with the option's UUID id
  -- (see ATTRIBUTE_TYPE_COLUMN_MAP in packages/shared); join to
  -- `select_options.id` to get the human title. The reviews-engine code in
  -- inbound-scanner.ts / reviews-send already treats `text_value` as a literal
  -- 'kottke' / 'ceylan' string, so we COALESCE to the raw text_value as a
  -- fallback. brand is single-select, so at most one row per deal.
  deal_brand AS (
    SELECT
      rv.record_id AS deal_record_id,
      COALESCE(so.title, rv.text_value) AS brand
    FROM record_values rv
    JOIN brand_attrs ba ON ba.attribute_id = rv.attribute_id
    LEFT JOIN select_options so ON so.id = rv.text_value
  ),
  -- One row per deal-with-a-review-left, keyed on the week the review came in.
  deal_review_left AS (
    SELECT
      rv.record_id AS deal_record_id,
      date_trunc('week', rv.timestamp_value)::date AS week_start
    FROM record_values rv
    JOIN left_at_attrs la ON la.attribute_id = rv.attribute_id
    WHERE rv.timestamp_value IS NOT NULL
  ),
  -- Latest send-variant per deal — used to attribute a review-left to A or B
  -- even when the leave-week differs from the send-week.
  deal_variant AS (
    SELECT DISTINCT ON (deal_record_id)
      deal_record_id,
      variant
    FROM review_events
    WHERE event_type = 'sent_sms' AND variant IN ('A', 'B')
    ORDER BY deal_record_id, at DESC
  ),
  event_facts AS (
    SELECT
      COALESCE(db.brand, 'unknown') AS brand,
      date_trunc('week', re.at)::date AS week_start,
      COUNT(*) FILTER (WHERE re.event_type = 'sent_sms')                      AS sends,
      COUNT(*) FILTER (WHERE re.event_type = 'clicked')                       AS clicks,
      COUNT(*) FILTER (WHERE re.event_type = 'complaint_routed')              AS complaint_valve_fires,
      COUNT(*) FILTER (WHERE re.event_type = 'sent_sms' AND re.variant = 'A') AS variant_a_sends,
      COUNT(*) FILTER (WHERE re.event_type = 'sent_sms' AND re.variant = 'B') AS variant_b_sends
    FROM review_events re
    LEFT JOIN deal_brand db ON db.deal_record_id = re.deal_record_id
    GROUP BY 1, 2
  ),
  leave_facts AS (
    SELECT
      COALESCE(db.brand, 'unknown') AS brand,
      drl.week_start,
      COUNT(*)                                 AS reviews_left,
      COUNT(*) FILTER (WHERE dv.variant = 'A') AS variant_a_leaves,
      COUNT(*) FILTER (WHERE dv.variant = 'B') AS variant_b_leaves
    FROM deal_review_left drl
    LEFT JOIN deal_brand db   ON db.deal_record_id = drl.deal_record_id
    LEFT JOIN deal_variant dv ON dv.deal_record_id = drl.deal_record_id
    GROUP BY 1, 2
  ),
  weeks AS (
    SELECT brand, week_start FROM event_facts
    UNION
    SELECT brand, week_start FROM leave_facts
  )
SELECT
  w.brand                                                                       AS brand,
  w.week_start                                                                  AS week_start,
  COALESCE(ef.sends, 0)::int                                                    AS sends,
  COALESCE(ef.clicks, 0)::int                                                   AS clicks,
  CASE WHEN COALESCE(ef.sends, 0) = 0 THEN NULL
       ELSE ROUND(ef.clicks::numeric / ef.sends, 4) END                         AS click_rate,
  COALESCE(lf.reviews_left, 0)::int                                             AS reviews_left,
  CASE WHEN COALESCE(ef.sends, 0) = 0 THEN NULL
       ELSE ROUND(COALESCE(lf.reviews_left, 0)::numeric / ef.sends, 4) END      AS leave_rate,
  NULL::numeric                                                                 AS avg_new_star_rating,
  COALESCE(ef.complaint_valve_fires, 0)::int                                    AS complaint_valve_fires,
  COALESCE(ef.variant_a_sends, 0)::int                                          AS variant_a_sends,
  CASE WHEN COALESCE(ef.variant_a_sends, 0) = 0 THEN NULL
       ELSE ROUND(COALESCE(lf.variant_a_leaves, 0)::numeric / ef.variant_a_sends, 4) END
                                                                                AS variant_a_leave_rate,
  COALESCE(ef.variant_b_sends, 0)::int                                          AS variant_b_sends,
  CASE WHEN COALESCE(ef.variant_b_sends, 0) = 0 THEN NULL
       ELSE ROUND(COALESCE(lf.variant_b_leaves, 0)::numeric / ef.variant_b_sends, 4) END
                                                                                AS variant_b_leave_rate
FROM weeks w
LEFT JOIN event_facts ef ON ef.brand = w.brand AND ef.week_start = w.week_start
LEFT JOIN leave_facts lf ON lf.brand = w.brand AND lf.week_start = w.week_start;
