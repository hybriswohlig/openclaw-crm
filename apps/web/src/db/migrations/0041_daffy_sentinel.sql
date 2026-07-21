ALTER TABLE "quotations" ADD COLUMN "calculation_assumptions" jsonb;--> statement-breakpoint
ALTER TABLE "quotation_package_options" ADD COLUMN "excluded_items" jsonb DEFAULT '[]'::jsonb NOT NULL;