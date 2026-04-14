/**
 * Audit log for field-level changes on records — used by the "version
 * control" / activity timeline on lead and company detail pages.
 *
 * Each row represents a single attribute's transition on a single record.
 * Attribute slug + title are denormalised so history remains readable even
 * if the attribute is later renamed or deleted.
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { records } from "./records";
import { users } from "./auth";

export const recordChanges = pgTable(
  "record_changes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    /** Attribute slug at the time of the change (denormalised). */
    attributeSlug: text("attribute_slug").notNull(),
    /** Attribute display title at the time of the change (denormalised). */
    attributeTitle: text("attribute_title").notNull(),
    /** Attribute type at the time of the change (for rendering). */
    attributeType: text("attribute_type").notNull(),
    /** Previous value as stored by writeValues, or null if the field was empty. */
    oldValue: jsonb("old_value"),
    /** New value as stored by writeValues, or null if the field was cleared. */
    newValue: jsonb("new_value"),
    /** User who made the change. Nullable for system/import writes. */
    changedBy: text("changed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    changedAt: timestamp("changed_at").notNull().defaultNow(),
  },
  (table) => [
    index("record_changes_record_id").on(table.recordId, table.changedAt),
  ]
);

/**
 * Quick comments / updates attached to a record — the "updates" side of the
 * monday-style feed. Short-form, flat (no nested replies in v1), rendered in
 * the same Activity timeline alongside field changes.
 *
 * Longer-form, rich-text notes still live in the `notes` table and are
 * surfaced under the Notes tab.
 */
export const recordComments = pgTable(
  "record_comments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("record_comments_record_id").on(table.recordId, table.createdAt),
  ]
);
