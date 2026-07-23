import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  boolean,
  integer,
  jsonb,
  numeric,
  bigserial,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspace";
import { records } from "./records";
import { users } from "./auth";
import { inboxMessages, inboxConversations } from "./inbox";

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

// ─────────────────────────────────────────────────────────────────────────────
// KI-Verkaufsassistent 2.0 substrate (Phase 0, docs/ai-sales-agent-plan.md).
// Deterministic code decides WHO may be contacted and WHEN; the LLM only writes
// text. These tables are the typed state that replaces title regexes, JSONB
// caches and "the model will figure it out from the transcript".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-deal agent state: sticky human ownership + cadence scheduling. One row
 * per deal the agent has ever considered. `humanOwned` is STICKY: set when an
 * operator sends on any of the deal's threads (inbox UI or Baileys phone echo)
 * and cleared only by an explicit release action — never by silence.
 */
export const dealAgentState = pgTable(
  "deal_agent_state",
  {
    dealRecordId: text("deal_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Brand binding, resolved once from the deal / first conversation's channel
    // account. Immutable by contract (the model never chooses the brand).
    operatingCompanyRecordId: text("operating_company_record_id").references(
      () => records.id,
      { onDelete: "set null" }
    ),
    humanOwned: boolean("human_owned").notNull().default(false),
    humanOwnedBy: text("human_owned_by").references(() => users.id, { onDelete: "set null" }),
    humanOwnedAt: timestamp("human_owned_at"),
    humanReleasedAt: timestamp("human_released_at"),
    // ── Cadence scheduling (columns, not prompt inference) ──────────────────
    sequenceId: text("sequence_id"),
    currentStep: integer("current_step").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextActionAt: timestamp("next_action_at"),
    lastOutboundAt: timestamp("last_outbound_at"),
    // 'replied' | 'opted_out' | 'stage_closed' | 'human_owned' | 'bounced'
    // (app-enforced). NULL = cadence may continue. No max-attempts stop reason:
    // owner decision 2026-07-22, sequences run until a real stop signal.
    stopReason: text("stop_reason"),
    // ── Conversation register ───────────────────────────────────────────────
    language: text("language").notNull().default("de"),
    // 'sie' | 'du' — locked to how the customer writes; checked on drafts.
    register: text("register"),
    // WhatsApp 24h customer-service window (WABA; informational on Baileys).
    windowExpiresAt: timestamp("window_expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("deal_agent_state_ws_idx").on(table.workspaceId),
    // Hot query of the cadence scheduler cron.
    index("deal_agent_state_next_action_idx")
      .on(table.nextActionAt)
      .where(sql`${table.nextActionAt} is not null`),
  ]
);

/**
 * Typed prequalification slot store — one row per (deal, slot). Doubles as the
 * human's Angebot checklist and prevents re-asking (asked_count/last_asked_at).
 * Mirrored into the deal's EAV attributes via applyDealInsights(onlyFillEmpty);
 * this table is the provenance-bearing source for the agent.
 */
export const qualificationSlots = pgTable(
  "qualification_slots",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    // 'move_date' | 'from_address' | 'to_address' | 'floor_from' | 'floor_to'
    // | 'elevator_from' | 'elevator_to' | 'rooms_volume' | 'special_items'
    // | 'packing_service' | 'parking_halteverbot' | 'followup_consent'
    slotKey: text("slot_key").notNull(),
    // 'missing' | 'asked' | 'filled' | 'inferred' | 'refused' | 'confirmed'
    status: text("status").notNull().default("missing"),
    valueJson: jsonb("value_json"),
    // 0.00–1.00 extraction confidence (LLM-reported, advisory).
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    // Which inbound message the value came from ("what did we know when").
    sourceMessageId: text("source_message_id").references(() => inboxMessages.id, {
      onDelete: "set null",
    }),
    askedCount: integer("asked_count").notNull().default(0),
    lastAskedAt: timestamp("last_asked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("qualification_slots_deal_slot_idx").on(table.dealRecordId, table.slotKey),
    index("qualification_slots_ws_idx").on(table.workspaceId),
  ]
);

/**
 * Append-only decision log for every agent engine action (draft, gate block,
 * send, skip, heartbeat, …). DB-enforced immutability: migration 0043 installs
 * a BEFORE UPDATE/DELETE trigger that raises. Never write from anything but
 * INSERT paths.
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Deliberately NO FK: an ON DELETE action would mutate this append-only
    // table (blocked by the immutability trigger) and thereby break hard
    // record deletion. The log outlives its subjects.
    dealRecordId: text("deal_record_id"),
    conversationId: text("conversation_id"),
    // 'reply' | 'followup' | 'first_contact' | 'send_worker' | 'classifier'
    // | 'transcribe' | 'rollup' | 'playbook' | 'eval'
    engine: text("engine").notNull(),
    // e.g. 'draft_created' | 'gate_blocked' | 'sent' | 'skipped' | 'heartbeat'
    eventType: text("event_type").notNull(),
    promptVersion: text("prompt_version"),
    playbookVersion: text("playbook_version"),
    modelTag: text("model_tag"),
    // Full verdict list from agentMayContact / output filters, for forensics.
    gateResults: jsonb("gate_results"),
    payload: jsonb("payload"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("agent_events_ws_created_idx").on(table.workspaceId, table.createdAt),
    index("agent_events_deal_created_idx").on(table.dealRecordId, table.createdAt),
    uniqueIndex("agent_events_idempotency_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ]
);

/**
 * The approval queue. Every outbound the agent wants to send becomes a draft;
 * the send worker consumes approved/auto-queued drafts and re-gates + re-filters
 * on the FINAL text inside the send transaction. approve/edit/dismiss labels
 * seed the learning loop. Idempotency (deal, sequence, step) kills the
 * duplicate-send race class from 2026-06-03.
 */
export const agentDrafts = pgTable(
  "agent_drafts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => inboxConversations.id, {
      onDelete: "set null",
    }),
    channelAccountId: text("channel_account_id"),
    // 'slot_question' | 'ack' | 'followup' | 'first_contact' | 'handoff_ack'
    messageClass: text("message_class").notNull(),
    draftText: text("draft_text").notNull(),
    // Post-humanizer, post-signature text that was/would be sent (L4 re-scan target).
    finalText: text("final_text"),
    // Per-filter verdicts on the final text: price, brand, language, similarity.
    filterVerdicts: jsonb("filter_verdicts"),
    gateResults: jsonb("gate_results"),
    // 'pending' | 'approved' | 'edited' | 'dismissed' | 'auto_queued'
    // | 'auto_sent' | 'sent' | 'expired' | 'cancelled' | 'gate_blocked'
    status: text("status").notNull().default("pending"),
    reviewerUserId: text("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    sequenceId: text("sequence_id"),
    sequenceStep: integer("sequence_step"),
    idempotencyKey: text("idempotency_key"),
    expiresAt: timestamp("expires_at"),
    sentMessageId: text("sent_message_id"),
    promptVersion: text("prompt_version"),
    playbookVersion: text("playbook_version"),
    modelTag: text("model_tag"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("agent_drafts_ws_status_idx").on(table.workspaceId, table.status, table.createdAt),
    index("agent_drafts_deal_idx").on(table.dealRecordId),
    uniqueIndex("agent_drafts_idempotency_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ]
);

/**
 * Consent evidence per person × channel × purpose (§7 UWG / Art. 7 DSGVO).
 * The gate treats a purpose as permitted only with a grant row whose
 * revoked_at IS NULL. Rewritten by mergePersons like other person references.
 */
export const consentLedger = pgTable(
  "consent_ledger",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    personRecordId: text("person_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    // 'whatsapp' | 'email' | 'sms'
    channel: text("channel").notNull(),
    // 'reply_to_inquiry' | 'proactive_followup' | 'marketing'
    purpose: text("purpose").notNull(),
    // The exact wording the customer saw/said — legal evidence, never templated
    // after the fact.
    exactWording: text("exact_wording"),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    sourceMessageId: text("source_message_id").references(() => inboxMessages.id, {
      onDelete: "set null",
    }),
    sourceConversationId: text("source_conversation_id"),
    revokedAt: timestamp("revoked_at"),
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("consent_ledger_person_idx").on(table.personRecordId),
    index("consent_ledger_ws_person_idx").on(table.workspaceId, table.personRecordId),
  ]
);

/**
 * Derived, rebuildable rolling summary of a deal's cross-channel conversation.
 * The prompt context builder uses this + last N messages instead of full
 * transcript replay.
 */
export const conversationRollups = pgTable(
  "conversation_rollups",
  {
    dealRecordId: text("deal_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    coversThroughMessageId: text("covers_through_message_id"),
    coversThroughAt: timestamp("covers_through_at"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("conversation_rollups_ws_idx").on(table.workspaceId)]
);

/**
 * Versioned, per-brand prompt guidance distilled offline from won/lost
 * conversations. Only a human activates a version; the eval suite gates
 * activation. operating_company_record_id NULL = applies to all brands.
 * App-enforced: at most one 'active' version per (workspace, OC).
 */
export const agentPlaybooks = pgTable(
  "agent_playbooks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operatingCompanyRecordId: text("operating_company_record_id").references(() => records.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull(),
    // 'draft' | 'active' | 'retired'
    status: text("status").notNull().default("draft"),
    title: text("title"),
    // Guidance sections, few-shot example tags, question-order hints.
    content: jsonb("content").notNull(),
    activatedAt: timestamp("activated_at"),
    activatedBy: text("activated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("agent_playbooks_ws_idx").on(table.workspaceId, table.status),
    // NULL OC is distinct in Postgres; workspace-wide playbooks rely on app
    // discipline for version uniqueness.
    uniqueIndex("agent_playbooks_ws_oc_version_idx").on(
      table.workspaceId,
      table.operatingCompanyRecordId,
      table.version
    ),
  ]
);

/** Approved message variants (openers, slot questions, follow-ups) for A/B. */
export const messageVariants = pgTable(
  "message_variants",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operatingCompanyRecordId: text("operating_company_record_id").references(() => records.id, {
      onDelete: "set null",
    }),
    messageClass: text("message_class").notNull(),
    variantKey: text("variant_key").notNull(),
    content: text("content").notNull(),
    // 'active' | 'retired'
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("message_variants_ws_class_key_idx").on(
      table.workspaceId,
      table.messageClass,
      table.variantKey
    ),
  ]
);

/** Per-variant per-day counters: sends → replies → conversions. */
export const variantStats = pgTable(
  "variant_stats",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => messageVariants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    sends: integer("sends").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.variantId, table.date] })]
);

/**
 * Labeled evaluation cases built from historical conversations. `frozen` rows
 * (incident threads, e.g. the 2026-06-03 set and "Pablo") are never edited.
 * Every prompt/playbook change must pass the suite before rollout — with 100%
 * block rate on 'must_not_contact' and 'price_red_team' kinds.
 */
export const evalCases = pgTable(
  "eval_cases",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // 'slot_extraction' | 'must_not_contact' | 'price_red_team'
    // | 'draft_quality' | 'outcome_label'
    kind: text("kind").notNull(),
    dealRecordId: text("deal_record_id").references(() => records.id, { onDelete: "set null" }),
    conversationId: text("conversation_id"),
    // Transcript snapshot / scenario as presented to the engine under test.
    input: jsonb("input").notNull(),
    // Ground-truth labels (expected slots, expected gate verdict, …).
    expected: jsonb("expected").notNull(),
    notes: text("notes"),
    frozen: boolean("frozen").notNull().default(false),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("eval_cases_ws_kind_idx").on(table.workspaceId, table.kind)]
);

/** One row per eval-suite execution (CI gate + manual runs). */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    gitRef: text("git_ref"),
    promptVersion: text("prompt_version"),
    playbookVersion: text("playbook_version"),
    totalCases: integer("total_cases").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    // Per-case verdicts for drill-down.
    results: jsonb("results"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("eval_runs_ws_created_idx").on(table.workspaceId, table.createdAt)]
);
