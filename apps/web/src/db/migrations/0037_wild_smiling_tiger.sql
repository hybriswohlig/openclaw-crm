ALTER TABLE "expenses" ALTER COLUMN "deal_record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "deal_record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "operating_company_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "operating_company_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_operating_company_id_records_id_fk" FOREIGN KEY ("operating_company_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_operating_company_id_records_id_fk" FOREIGN KEY ("operating_company_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_company_idx" ON "expenses" USING btree ("operating_company_id");--> statement-breakpoint
CREATE INDEX "payments_company_idx" ON "payments" USING btree ("operating_company_id");