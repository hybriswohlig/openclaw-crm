import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

// review_events — append-only audit trail for the post-move reviews engine.
// Every state transition (scheduled, sent_sms, clicked, complaint_routed,
// suppressed, failed, reply_received, review_left, sent_whatsapp) writes a
// row so "why did this lead get/not get a message" is a single SQL query.
//
// deal_record_id is the lead/deal `records.id`. variant + channel are nullable
// because some events (e.g. suppressed before send) don't have them yet.
export const reviewEvents = pgTable(
  "review_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    variant: text("variant"),
    channel: text("channel"),
    meta: jsonb("meta").notNull().default({}),
    at: timestamp("at").notNull().defaultNow(),
  },
  (table) => [
    index("review_events_deal_idx").on(table.dealRecordId, table.at),
    index("review_events_workspace_idx").on(table.workspaceId, table.at),
    index("review_events_event_type_idx").on(table.workspaceId, table.eventType, table.at),
  ]
);

// review_tokens — opaque per-lead short-link tokens for the tracked review
// link. The /r/{token} endpoint looks up the row, logs the click, advances
// the deal's review_request_status, and 302s to destination_url.
export const reviewTokens = pgTable(
  "review_tokens",
  {
    token: text("token").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    destinationUrl: text("destination_url").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    clickedAt: timestamp("clicked_at"),
    clickUserAgent: text("click_user_agent"),
    clickIp: text("click_ip"),
  },
  (table) => [
    index("review_tokens_deal_idx").on(table.dealRecordId),
  ]
);
