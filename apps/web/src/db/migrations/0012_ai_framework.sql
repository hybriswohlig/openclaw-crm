-- P0a: AI task framework + activity events + encrypted workspace settings.
-- Adds four tables plus the pgcrypto extension used by workspace_settings secrets.

CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

CREATE TABLE "workspace_settings" (
  "workspace_id" text NOT NULL,
  "key" text NOT NULL,
  "value_plain" text,
  "value_encrypted" bytea,
  "is_secret" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_settings_pk" PRIMARY KEY ("workspace_id", "key")
);--> statement-breakpoint

ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "ai_task_configs" (
  "workspace_id" text NOT NULL,
  "task_slug" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "fallback_model" text,
  "temperature" numeric(3, 2),
  "max_tokens" integer,
  "enabled" boolean NOT NULL DEFAULT true,
  "daily_spend_cap_usd" numeric(10, 2),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ai_task_configs_pk" PRIMARY KEY ("workspace_id", "task_slug")
);--> statement-breakpoint

ALTER TABLE "ai_task_configs" ADD CONSTRAINT "ai_task_configs_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "ai_task_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "task_slug" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "cost_usd" numeric(10, 6),
  "latency_ms" integer,
  "success" boolean NOT NULL,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "ai_task_runs" ADD CONSTRAINT "ai_task_runs_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ai_task_runs_workspace_created_idx" ON "ai_task_runs" USING btree ("workspace_id", "created_at");--> statement-breakpoint
CREATE INDEX "ai_task_runs_task_created_idx" ON "ai_task_runs" USING btree ("task_slug", "created_at");--> statement-breakpoint

CREATE TABLE "activity_events" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "record_id" text,
  "object_slug" text,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_id" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "activity_events_workspace_record_created_idx" ON "activity_events" USING btree ("workspace_id", "record_id", "created_at");--> statement-breakpoint
CREATE INDEX "activity_events_type_created_idx" ON "activity_events" USING btree ("event_type", "created_at");
