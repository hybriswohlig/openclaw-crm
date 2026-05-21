-- Adds the 'worker_instructions' value to the deal_document_type enum so the
-- new Auftragsanweisung skill output can be stored alongside the customer
-- documents (order_confirmation, invoice, payment_confirmation).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block when the
-- new value is referenced in the same transaction. drizzle-kit migrate runs
-- each .sql file in its own transaction by default; this single statement
-- is fine on its own.
ALTER TYPE "public"."deal_document_type" ADD VALUE IF NOT EXISTS 'worker_instructions';
