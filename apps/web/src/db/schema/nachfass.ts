import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

/**
 * Per-deal Nachfass state. One row once the engine has looked at the deal.
 * Customer sends are recorded only after a human (or a later, still-off
 * auto-send switch) actually delivers the draft.
 */
export const nachfassDealState = pgTable(
  "nachfass_deal_state",
  {
    dealRecordId: text("deal_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operatingCompanyRecordId: text("operating_company_record_id"),
    stopReason: text("stop_reason"),
    freshStartedAt: timestamp("fresh_started_at"),
    fu1SentAt: timestamp("fu1_sent_at"),
    fu2SentAt: timestamp("fu2_sent_at"),
    closeSentAt: timestamp("close_sent_at"),
    ruleCSentAt: timestamp("rule_c_sent_at"),
    legacyFuSentAt: timestamp("legacy_fu_sent_at"),
    legacyCloseSentAt: timestamp("legacy_close_sent_at"),
    teamReminders: integer("team_reminders").notNull().default(0),
    lastTeamReminderAt: timestamp("last_team_reminder_at"),
    triageAt: timestamp("triage_at"),
    triageOutcome: text("triage_outcome"),
    triageNote: text("triage_note"),
    infosCompleteAt: timestamp("infos_complete_at"),
    nextActionAt: timestamp("next_action_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("nachfass_deal_state_ws_idx").on(table.workspaceId),
    index("nachfass_deal_state_next_idx")
      .on(table.nextActionAt)
      .where(sql`${table.nextActionAt} is not null`),
  ]
);

/**
 * Per-rule, per-company auto-send switch. Missing row = OFF.
 * `operating_company_record_id` '' is the workspace-wide fallback.
 * This migration does not insert any ON row.
 */
export const nachfassRuleSwitches = pgTable(
  "nachfass_rule_switches",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operatingCompanyRecordId: text("operating_company_record_id").notNull().default(""),
    rule: text("rule").notNull(),
    autoSend: boolean("auto_send").notNull().default(false),
    cleanApprovals: integer("clean_approvals").notNull().default(0),
    correctedApprovals: integer("corrected_approvals").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.operatingCompanyRecordId, table.rule],
    }),
  ]
);

/** Berlin-day counters. sent_count is real customer sends; legacy_drafts is the backlog batch. */
export const nachfassDailySends = pgTable(
  "nachfass_daily_sends",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelAccountId: text("channel_account_id").notNull(),
    berlinDay: date("berlin_day").notNull(),
    sentCount: integer("sent_count").notNull().default(0),
    legacyDrafts: integer("legacy_drafts").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.channelAccountId, table.berlinDay],
    }),
  ]
);
