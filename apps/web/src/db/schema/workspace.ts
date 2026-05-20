import { pgTable, text, timestamp, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const workspaceRoleEnum = pgEnum("workspace_role", ["admin", "member"]);

/**
 * Granular per-member capabilities beyond the coarse admin/member role.
 *
 * Admins implicitly have every permission; this object only gates
 * additional rights given to `member`-role users. Stored as JSONB so we can
 * add more keys without migrations later.
 *
 * Currently defined keys:
 *   - manageChannels: create / edit / delete inbox channel accounts
 *     (email + WhatsApp Baileys + WhatsApp Cloud API rows under
 *     `channel_accounts`). Includes triggering the Baileys pair flow.
 */
export interface MemberPermissions {
  manageChannels?: boolean;
}

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    // Granular capabilities. Admins ignore this and have every right.
    // Empty object = no extra permissions beyond the role.
    permissions: jsonb("permissions")
      .$type<MemberPermissions>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_members_unique").on(table.workspaceId, table.userId),
  ]
);
