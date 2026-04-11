import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";

export const integrationTypeEnum = pgEnum("integration_type", [
  "built_in",
  "zapier",
  "custom",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "coming_soon",
  "active",
  "inactive",
]);

export const integrations = pgTable(
  "integrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Logo: either inline SVG markup or an external image URL
    logoSvg: text("logo_svg"),
    logoUrl: text("logo_url"),
    type: integrationTypeEnum("type").notNull().default("built_in"),
    status: integrationStatusEnum("status").notNull().default("coming_soon"),
    // Credentials — stored as plain text; encrypt at rest in a future iteration
    apiKey: text("api_key"),
    webhookUrl: text("webhook_url"),
    // Arbitrary JSON object: sync preferences, field mappings, event toggles, etc.
    syncRules: text("sync_rules"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("integrations_workspace_idx").on(table.workspaceId),
    uniqueIndex("integrations_workspace_slug_idx").on(
      table.workspaceId,
      table.slug
    ),
  ]
);
