-- Adds 'quotation' so Kostenvoranschlag PDFs can be stored next to AB/RE/AW.
-- Keep this file to a single ADD VALUE statement: drizzle-kit wraps each file
-- in a transaction, and PostgreSQL rejects using a newly added enum value in
-- the same transaction.
ALTER TYPE "public"."deal_document_type" ADD VALUE IF NOT EXISTS 'quotation';
