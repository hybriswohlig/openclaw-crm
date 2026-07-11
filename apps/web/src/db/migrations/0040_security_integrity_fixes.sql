-- Critical/high integrity fixes (2026-07-09)
-- 1) One KVA acceptance per deal (race-safe double-submit)
-- 2) Payment Belegnummern unique per workspace when set

-- Defensive: keep the oldest acceptance if duplicates already exist.
DELETE FROM "kva_confirmations" kc
USING "kva_confirmations" keep
WHERE kc."deal_record_id" = keep."deal_record_id"
  AND (keep."signed_at" < kc."signed_at"
       OR (keep."signed_at" = kc."signed_at" AND keep."id" < kc."id"));
--> statement-breakpoint
DROP INDEX IF EXISTS "kva_confirmations_deal_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kva_confirmations_deal_uniq"
  ON "kva_confirmations" ("deal_record_id");
--> statement-breakpoint
-- Partial unique so NULL receipt_number rows do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_receipt_number_uniq"
  ON "payments" ("workspace_id", "receipt_number")
  WHERE "receipt_number" IS NOT NULL;
