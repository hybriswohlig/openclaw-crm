-- Per-template variable labels. Meta's Graph API returns the raw placeholders
-- (`{{1}}`, `{{2}}`) but no semantics, so we let the user label each variable
-- once ("Kundenvorname", "Ansprechpartner") and persist it per WABA. Keyed on
-- (workspace, waba, template name, language) so the labels survive template
-- re-approval cycles that keep the same name.

CREATE TABLE IF NOT EXISTS "whatsapp_template_metadata" (
  "workspace_id" text NOT NULL,
  "waba_id" text NOT NULL,
  "template_name" text NOT NULL,
  "language_code" text NOT NULL,
  "variable_labels" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_template_metadata_pk"
    PRIMARY KEY ("workspace_id", "waba_id", "template_name", "language_code"),
  CONSTRAINT "whatsapp_template_metadata_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade
);
