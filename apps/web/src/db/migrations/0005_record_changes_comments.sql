CREATE TABLE IF NOT EXISTS "record_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"attribute_slug" text NOT NULL,
	"attribute_title" text NOT NULL,
	"attribute_type" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "record_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_changes" ADD CONSTRAINT "record_changes_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_changes" ADD CONSTRAINT "record_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_changes_record_id" ON "record_changes" USING btree ("record_id","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_comments_record_id" ON "record_comments" USING btree ("record_id","created_at");
