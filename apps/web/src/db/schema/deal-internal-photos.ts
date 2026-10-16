import { pgTable, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

// Agent photos that belong to the deal, not to a chat.
// inbox_message_attachments.message_id and conversation_id are NOT NULL, so a
// lead without a conversation (ImmoScout and similar) cannot store a photo
// there. These rows stay off the customer portal and never become a message.
// Created by src/db/migrate-2026-10-16-deal-internal-photos.ts — run that
// script before deploying code that inserts into this table.
export const dealInternalPhotos = pgTable(
  "deal_internal_photos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileContent: text("file_content").notNull(), // base64
    contentSha256: text("content_sha256").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("deal_internal_photos_hash_uniq").on(
      table.workspaceId,
      table.dealRecordId,
      table.contentSha256
    ),
    index("deal_internal_photos_deal_idx").on(table.workspaceId, table.dealRecordId),
  ]
);
