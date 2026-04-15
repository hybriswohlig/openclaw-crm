import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";

export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    recordId: text("record_id"),
    objectSlug: text("object_slug"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("activity_events_workspace_record_created_idx").on(
      table.workspaceId,
      table.recordId,
      table.createdAt
    ),
    index("activity_events_type_created_idx").on(table.eventType, table.createdAt),
  ]
);
