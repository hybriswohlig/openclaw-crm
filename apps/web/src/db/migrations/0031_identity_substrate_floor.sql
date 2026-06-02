-- ─── Substrate floor: inbox_contacts canonical UNIQUE partial indexes ─────────
-- MUST run AFTER migrate-2026-06-10-identity-backfill.ts has:
--   (1) populated inbox_contacts.phone_canonical / email_canonical, and
--   (2) resolved colliding contact rows (re-point crm_record_id + soft-merge),
-- otherwise these CREATE UNIQUE INDEX statements FAIL over existing duplicates
-- (the KA-relay + WhatsApp duplicate-contact bug is exactly such a collision).
--
-- Two separate single-column partial uniques (not one composite) so a contact
-- with only a phone and a contact with only an email never false-collide on a
-- shared NULL. NULLs are excluded by the WHERE predicate.

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_contacts_phone_canonical_uniq"
  ON "inbox_contacts" ("workspace_id", "phone_canonical")
  WHERE "phone_canonical" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_contacts_email_canonical_uniq"
  ON "inbox_contacts" ("workspace_id", "email_canonical")
  WHERE "email_canonical" IS NOT NULL;
