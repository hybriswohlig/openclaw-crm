import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";

/**
 * Per-person agent suppression list (opt-out). When a customer replies STOP (or
 * an equivalent decline) on ANY thread, their canonical phone and/or email are
 * recorded here, and all three automated engines (reply, follow-up, first
 * contact) check this list before sending. Keyed by the canonical identity
 * value, so an opt-out on one deal/channel suppresses outreach on every other
 * deal/channel for the same person (Art. 21 DSGVO is absolute and person-bound).
 */
export const agentSuppressions = pgTable(
  "agent_suppressions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // 'phone' | 'email' — the kind of canonical identity key.
    kind: text("kind").notNull(),
    // Canonical value: E.164 for phone, lowercased address for email.
    valueCanonical: text("value_canonical").notNull(),
    // Why it was suppressed (e.g. 'customer_stop').
    reason: text("reason"),
    // The conversation the opt-out arrived on, for audit (nullable).
    sourceConversationId: text("source_conversation_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_suppressions_ws_kind_value_idx").on(
      table.workspaceId,
      table.kind,
      table.valueCanonical
    ),
    index("agent_suppressions_ws_idx").on(table.workspaceId),
  ]
);
