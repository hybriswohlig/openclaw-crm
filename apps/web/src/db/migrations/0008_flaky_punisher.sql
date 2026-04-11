CREATE TYPE "public"."employee_transaction_status" AS ENUM('open', 'paid');--> statement-breakpoint
CREATE TYPE "public"."employee_transaction_type" AS ENUM('salary', 'advance', 'reimbursement');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('fuel', 'truck_rental', 'equipment', 'subcontractor', 'toll', 'other');--> statement-breakpoint
CREATE TABLE "deal_number_sequences" (
	"workspace_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deal_number_sequences_workspace_id_year_pk" PRIMARY KEY("workspace_id","year")
);
--> statement-breakpoint
CREATE TABLE "deal_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"deal_record_id" text NOT NULL,
	"year" integer NOT NULL,
	"sequence" integer NOT NULL,
	"deal_number" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deal_numbers_deal_record_id_unique" UNIQUE("deal_record_id")
);
--> statement-breakpoint
CREATE TABLE "employee_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"deal_record_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"type" "employee_transaction_type" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "employee_transaction_status" DEFAULT 'open' NOT NULL,
	"description" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"deal_record_id" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"category" "expense_category" DEFAULT 'other' NOT NULL,
	"description" text,
	"recipient" text,
	"payment_method" text,
	"receipt_file" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"deal_record_id" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payer" text,
	"payment_method" text,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_number_sequences" ADD CONSTRAINT "deal_number_sequences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_numbers" ADD CONSTRAINT "deal_numbers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_numbers" ADD CONSTRAINT "deal_numbers_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_numbers_workspace_year_seq_idx" ON "deal_numbers" USING btree ("workspace_id","year","sequence");--> statement-breakpoint
CREATE INDEX "deal_numbers_deal_record_idx" ON "deal_numbers" USING btree ("deal_record_id");--> statement-breakpoint
CREATE INDEX "deal_numbers_workspace_idx" ON "deal_numbers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "employee_transactions_deal_idx" ON "employee_transactions" USING btree ("deal_record_id");--> statement-breakpoint
CREATE INDEX "employee_transactions_employee_idx" ON "employee_transactions" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_transactions_workspace_idx" ON "employee_transactions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "employee_transactions_status_idx" ON "employee_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expenses_deal_idx" ON "expenses" USING btree ("deal_record_id");--> statement-breakpoint
CREATE INDEX "expenses_workspace_idx" ON "expenses" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category");--> statement-breakpoint
CREATE INDEX "payments_deal_idx" ON "payments" USING btree ("deal_record_id");--> statement-breakpoint
CREATE INDEX "payments_workspace_idx" ON "payments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("date");