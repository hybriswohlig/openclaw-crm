ALTER TYPE "public"."expense_category" ADD VALUE 'vehicle';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'repairs';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'office';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'rent';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'insurance';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'phone_internet';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'advertising';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'tax_advisor';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'entertainment';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'gifts';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'fines';--> statement-breakpoint
CREATE TABLE "beleg_number_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"operating_company_id" text NOT NULL,
	"year" integer NOT NULL,
	"kind" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tax_treatment" text DEFAULT 'voll' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deductible_percent" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "receipt_number" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tax_treatment" text DEFAULT 'betriebseinnahme' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_number" text;--> statement-breakpoint
ALTER TABLE "beleg_number_counters" ADD CONSTRAINT "beleg_number_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_number_counters" ADD CONSTRAINT "beleg_number_counters_operating_company_id_records_id_fk" FOREIGN KEY ("operating_company_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_number_counters_scope_uniq" ON "beleg_number_counters" USING btree ("workspace_id","operating_company_id","year","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_receipt_number_uniq" ON "expenses" USING btree ("workspace_id","receipt_number");--> statement-breakpoint
CREATE INDEX "payments_receipt_number_idx" ON "payments" USING btree ("receipt_number");--> statement-breakpoint
-- Custom backfill (Phase 2): map the legacy binary flag onto tax_treatment.
-- Existing rows got the column default 'voll'; non-deductible rows become 'nicht'.
-- payments need no backfill: the 'betriebseinnahme' default covers every row.
UPDATE "expenses" SET "tax_treatment" = CASE WHEN "is_tax_deductible" THEN 'voll' ELSE 'nicht' END;