import { pgTable, text, timestamp, numeric, index, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspace";
import { records } from "./records";

/**
 * One row per deal. input_hash is the conversation + notes the model already
 * saw, so an unchanged thread is never sent again. run_after is the debounce.
 */
export const dealEnrichmentCursors = pgTable(
  "deal_enrichment_cursors",
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
    inputHash: text("input_hash"),
    activityCursor: timestamp("activity_cursor"),
    runAfter: timestamp("run_after"),
    lastRunAt: timestamp("last_run_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("deal_enrichment_cursors_deal_unique").on(table.workspaceId, table.dealRecordId),
    index("deal_enrichment_cursors_run_after_idx").on(table.runAfter),
  ]
);

/** Pending confirmations and the memory of accepted, rejected, and auto-applied evidence. */
export const dealFieldSuggestions = pgTable(
  "deal_field_suggestions",
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
    fieldSlug: text("field_slug").notNull(),
    proposedValue: text("proposed_value").notNull(),
    proposedLabel: text("proposed_label").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    reason: text("reason").notNull(),
    evidenceQuote: text("evidence_quote").notNull(),
    evidenceSourceKind: text("evidence_source_kind").notNull(),
    evidenceSourceId: text("evidence_source_id").notNull(),
    evidenceKey: text("evidence_key").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
    decidedBy: text("decided_by"),
  },
  (table) => [
    unique("deal_field_suggestions_evidence_unique").on(table.dealRecordId, table.evidenceKey),
    uniqueIndex("deal_field_suggestions_pending_field_idx")
      .on(table.dealRecordId, table.fieldSlug)
      .where(sql`${table.status} = 'pending'`),
    index("deal_field_suggestions_status_idx").on(table.workspaceId, table.status, table.createdAt),
  ]
);
