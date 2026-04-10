CREATE TYPE "public"."line_item_type" AS ENUM('helper', 'transporter', 'other');--> statement-breakpoint
CREATE TABLE "deal_employees" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_record_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"role" text DEFAULT 'helper' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"experience" text,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"quotation_id" text NOT NULL,
	"type" "line_item_type" DEFAULT 'helper' NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_rate" numeric(10, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_record_id" text NOT NULL,
	"fixed_price" numeric(12, 2),
	"is_variable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_deal_record_id_unique" UNIQUE("deal_record_id")
);
--> statement-breakpoint
ALTER TABLE "deal_employees" ADD CONSTRAINT "deal_employees_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_employees" ADD CONSTRAINT "deal_employees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line_items" ADD CONSTRAINT "quotation_line_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_employees_deal_idx" ON "deal_employees" USING btree ("deal_record_id");--> statement-breakpoint
CREATE INDEX "deal_employees_employee_idx" ON "deal_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employees_workspace_idx" ON "employees" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "quotation_line_items_quotation_idx" ON "quotation_line_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "quotations_deal_idx" ON "quotations" USING btree ("deal_record_id");