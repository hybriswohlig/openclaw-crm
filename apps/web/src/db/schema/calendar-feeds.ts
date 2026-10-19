import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { workspaces } from "./workspace";

/**
 * Secret iCal subscription tokens. One active token per user and workspace.
 * The raw token is stored so the operator can copy the link again later.
 * Regenerating sets revoked_at; the partial unique index then allows a new row.
 */
export const calendarFeedTokens = pgTable(
  "calendar_feed_tokens",
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
    token: text("token").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("calendar_feed_tokens_token_idx").on(table.token),
    uniqueIndex("calendar_feed_tokens_active_user_idx")
      .on(table.workspaceId, table.userId)
      .where(sql`${table.revokedAt} is null`),
    index("calendar_feed_tokens_workspace_idx").on(table.workspaceId),
  ]
);
