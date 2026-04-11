CREATE TYPE "public"."deal_document_type" AS ENUM('order_confirmation', 'invoice', 'payment_confirmation');

CREATE TABLE "deal_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "deal_record_id" text NOT NULL,
  "document_type" "deal_document_type" NOT NULL,
  "file_name" text NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  "file_content" text NOT NULL,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "deal_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "deal_documents_deal_record_id_records_id_fk" FOREIGN KEY ("deal_record_id") REFERENCES "public"."records"("id") ON DELETE cascade
);

CREATE INDEX "deal_documents_deal_idx" ON "deal_documents" ("deal_record_id");
CREATE INDEX "deal_documents_workspace_idx" ON "deal_documents" ("workspace_id");
CREATE INDEX "deal_documents_type_idx" ON "deal_documents" ("document_type");
