CREATE TYPE "public"."integration_type" AS ENUM('built_in', 'zapier', 'custom');
CREATE TYPE "public"."integration_status" AS ENUM('coming_soon', 'active', 'inactive');

CREATE TABLE "integrations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "logo_svg" text,
  "logo_url" text,
  "type" "integration_type" NOT NULL DEFAULT 'built_in',
  "status" "integration_status" NOT NULL DEFAULT 'coming_soon',
  "api_key" text,
  "webhook_url" text,
  "sync_rules" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "integrations_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade
);

CREATE INDEX "integrations_workspace_idx" ON "integrations" ("workspace_id");
CREATE UNIQUE INDEX "integrations_workspace_slug_idx" ON "integrations" ("workspace_id", "slug");
