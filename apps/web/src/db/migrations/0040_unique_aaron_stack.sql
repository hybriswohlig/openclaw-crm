CREATE TYPE "public"."inventory_confidence" AS ENUM('hoch', 'mittel', 'niedrig');--> statement-breakpoint
CREATE TYPE "public"."inventory_size_class" AS ENUM('klein', 'mittel', 'gross', 'sperrig');--> statement-breakpoint
CREATE TYPE "public"."inventory_source" AS ENUM('chat', 'foto', 'operator');--> statement-breakpoint
CREATE TABLE "deal_inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"deal_record_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"size_class" "inventory_size_class",
	"heavy_flag" boolean DEFAULT false NOT NULL,
	"fragile_flag" boolean DEFAULT false NOT NULL,
	"disassembly_required" boolean DEFAULT false NOT NULL,
	"move_flag" boolean DEFAULT true NOT NULL,
	"photo_attachment_id" text,
	"dimensions_estimate" text,
	"volume_cbm_estimate" numeric,
	"confidence" "inventory_confidence",
	"source" "inventory_source" DEFAULT 'chat' NOT NULL,
	"needs_photo" boolean DEFAULT false NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "kva_confirmations_deal_idx";--> statement-breakpoint
ALTER TABLE "deal_inventory_items" ADD CONSTRAINT "deal_inventory_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_inventory_items" ADD CONSTRAINT "deal_inventory_items_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_inventory_items" ADD CONSTRAINT "deal_inventory_items_photo_attachment_id_inbox_message_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."inbox_message_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_inventory_deal_idx" ON "deal_inventory_items" USING btree ("deal_record_id");--> statement-breakpoint
CREATE INDEX "deal_inventory_workspace_idx" ON "deal_inventory_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_number_uniq" ON "payments" USING btree ("workspace_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "kva_confirmations_deal_uniq" ON "kva_confirmations" USING btree ("deal_record_id");