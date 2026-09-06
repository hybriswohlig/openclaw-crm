ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "service_type" text DEFAULT 'move' NOT NULL,
  ADD COLUMN IF NOT EXISTS "document_details" jsonb;

ALTER TABLE "deal_inventory_items"
  ADD COLUMN IF NOT EXISTS "dismantling_owner" text DEFAULT 'none' NOT NULL,
  ADD COLUMN IF NOT EXISTS "assembly_owner" text DEFAULT 'none' NOT NULL;
