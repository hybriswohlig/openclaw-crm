import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

/**
 * One finished phone call. The transcript lives here, not in activity_events,
 * so the home feed never loads the spoken text. external_id is the sender's
 * idempotency key (Asterisk LINKEDID later).
 */
export const phoneCalls = pgTable(
  "phone_calls",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    callerRaw: text("caller_raw"),
    callerE164: text("caller_e164"),
    calledRaw: text("called_raw"),
    calledE164: text("called_e164"),
    lineLabel: text("line_label"),
    answeredBy: text("answered_by"),
    startedAt: timestamp("started_at").notNull(),
    durationSeconds: integer("duration_seconds"),
    transcript: text("transcript"),
    summary: text("summary"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    personRecordId: text("person_record_id").references(() => records.id, { onDelete: "set null" }),
    matchStatus: text("match_status").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("phone_calls_workspace_external_idx").on(table.workspaceId, table.externalId),
    index("phone_calls_person_idx").on(table.personRecordId),
    index("phone_calls_caller_idx").on(table.workspaceId, table.callerE164),
    index("phone_calls_started_idx").on(table.workspaceId, table.startedAt),
  ]
);
