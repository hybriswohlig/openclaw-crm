import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  customType,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valuePlain: text("value_plain"),
    valueEncrypted: bytea("value_encrypted"),
    isSecret: boolean("is_secret").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })]
);

export const aiTaskConfigs = pgTable(
  "ai_task_configs",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskSlug: text("task_slug").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    fallbackModel: text("fallback_model"),
    temperature: numeric("temperature", { precision: 3, scale: 2 }),
    maxTokens: integer("max_tokens"),
    enabled: boolean("enabled").notNull().default(true),
    dailySpendCapUsd: numeric("daily_spend_cap_usd", { precision: 10, scale: 2 }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.taskSlug] })]
);

export const aiTaskRuns = pgTable(
  "ai_task_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskSlug: text("task_slug").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    latencyMs: integer("latency_ms"),
    success: boolean("success").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("ai_task_runs_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("ai_task_runs_task_created_idx").on(table.taskSlug, table.createdAt),
  ]
);
