import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { workspaces } from "./workspace";

/**
 * Web Push subscriptions, one row per device/browser. iOS requires the user
 * to first add the app to the homescreen — the installed PWA then registers
 * a subscription via the service worker and POSTs the endpoint+keys here.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // Free-form label so users can tell devices apart in settings
    deviceLabel: text("device_label"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subs_endpoint_unique").on(table.endpoint),
    index("push_subs_user_idx").on(table.userId),
    index("push_subs_workspace_idx").on(table.workspaceId),
  ]
);
