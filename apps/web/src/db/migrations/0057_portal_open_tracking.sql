-- Customer-portal open tracking.
--
-- RUN THIS FILE BY HAND before deploy. Do not rely on drizzle's
-- __drizzle_migrations journal (`pnpm db:migrate` is not part of this change).
-- The application tolerates a missing table or missing columns: tracking
-- writes are try/catch and must never break the portal page or PDF delivery.
-- Until this file is applied, PDF view rows are skipped and visits keep the
-- previous beacon behaviour (no internal/pre-send split).
--
-- sent_at: first outbound inbox message whose body or HTML contains /s/<token>.
-- Copying the link in the CRM does not set it. New visits while sent_at IS
-- NULL, and visits with opened_at < sent_at, are stored with
-- is_internal = true (reason pre_send) and excluded from customer counts.
-- Historical visits on links we cannot match to a message are left as
-- customer rows so existing engagement is not wiped. Idempotent.

ALTER TABLE "customer_status_links"
  ADD COLUMN IF NOT EXISTS "sent_at" timestamp;

COMMENT ON COLUMN "customer_status_links"."sent_at" IS
  'First outbound customer message that contained /s/<token>. NULL until then. Visits before this are pre-send (intern/Test) and excluded from customer open counts. Set by markCustomerLinkSentFromOutbound.';

ALTER TABLE "customer_portal_visits"
  ADD COLUMN IF NOT EXISTS "is_internal" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "internal_reason" text;

COMMENT ON COLUMN "customer_portal_visits"."is_internal" IS
  'CRM session, operator Öffnen (share_panel), or opened before customer_status_links.sent_at. Stored but excluded from customer counts.';

CREATE TABLE IF NOT EXISTS "customer_portal_document_views" (
  "id" text PRIMARY KEY NOT NULL,
  "customer_link_id" text NOT NULL REFERENCES "customer_status_links"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
  "document_id" text NOT NULL,
  "file_name" text,
  "document_type" text,
  "session_id" text,
  "disposition" text,
  "user_agent" text,
  "ip_address" text,
  "is_internal" boolean NOT NULL DEFAULT false,
  "internal_reason" text,
  "viewed_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "customer_portal_document_views_link_doc_idx"
  ON "customer_portal_document_views" ("customer_link_id", "document_id", "viewed_at" DESC);

CREATE INDEX IF NOT EXISTS "customer_portal_document_views_deal_idx"
  ON "customer_portal_document_views" ("deal_record_id", "viewed_at" DESC);

-- Best-effort: earliest outbound message that actually contained this token.
-- A following token-character means a longer id, not this link.
UPDATE "customer_status_links" AS l
SET "sent_at" = src.first_sent
FROM (
  SELECT l2.id AS id,
         MIN(COALESCE(m.sent_at, m.created_at)) AS first_sent
  FROM "customer_status_links" l2
  INNER JOIN "inbox_conversations" c ON c.deal_record_id = l2.deal_record_id
  INNER JOIN "inbox_messages" m
    ON m.conversation_id = c.id
   AND m.direction = 'outbound'
  WHERE l2.sent_at IS NULL
    AND (
      (
        m.body LIKE '%/s/%'
        AND strpos(m.body, '/s/' || l2.token) > 0
        AND substring(
          m.body
          from strpos(m.body, '/s/' || l2.token) + char_length('/s/' || l2.token)
          for 1
        ) !~ '^[A-Za-z0-9_-]$'
      )
      OR (
        COALESCE(m.body_html, '') LIKE '%/s/%'
        AND strpos(COALESCE(m.body_html, ''), '/s/' || l2.token) > 0
        AND substring(
          COALESCE(m.body_html, '')
          from strpos(COALESCE(m.body_html, ''), '/s/' || l2.token) + char_length('/s/' || l2.token)
          for 1
        ) !~ '^[A-Za-z0-9_-]$'
      )
    )
  GROUP BY l2.id
) AS src
WHERE l.id = src.id
  AND l.sent_at IS NULL;

-- Only visits we can prove happened before the link went out. Unmatched
-- historical visits stay customer-facing.
UPDATE "customer_portal_visits" AS v
SET "is_internal" = true,
    "internal_reason" = 'pre_send'
FROM "customer_status_links" AS l
WHERE v.customer_link_id = l.id
  AND l.sent_at IS NOT NULL
  AND v.opened_at < l.sent_at
  AND v.is_internal = false;

-- Customer-facing counters from real sessions, not from page renders.
UPDATE "customer_status_links" AS l
SET "view_count" = COALESCE(s.n, 0),
    "session_count" = COALESCE(s.n, 0),
    "total_active_ms" = COALESCE(s.ms, 0),
    "first_viewed_at" = s.first_at,
    "last_viewed_at" = s.last_at
FROM (
  SELECT l2.id AS id,
         COUNT(v.id) FILTER (WHERE v.id IS NOT NULL AND NOT v.is_internal)::int AS n,
         COALESCE(SUM(v.active_ms) FILTER (WHERE v.id IS NOT NULL AND NOT v.is_internal), 0) AS ms,
         MIN(v.opened_at) FILTER (WHERE v.id IS NOT NULL AND NOT v.is_internal) AS first_at,
         MAX(v.last_heartbeat_at) FILTER (WHERE v.id IS NOT NULL AND NOT v.is_internal) AS last_at
  FROM "customer_status_links" l2
  LEFT JOIN "customer_portal_visits" v ON v.customer_link_id = l2.id
  GROUP BY l2.id
) AS s
WHERE l.id = s.id;
