/**
 * BioTech CRM — dedicated tables for structured entities that cannot be
 * cleanly modelled as flexible objects/attributes: Trade Fairs, Teams, Markets,
 * and their relations to CRM records.
 */
import {
  pgTable,
  text,
  timestamp,
  date,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { users } from "./auth";
import { records } from "./records";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const crmTeamEnum = pgEnum("crm_team", [
  "ne_germany",
  "ne_france",
  "ne_uk",
  "ne_singapore",
  "unassigned",
]);

// ─── Teams ────────────────────────────────────────────────────────────────────

/**
 * N&E regional teams. New teams can be added by inserting rows here rather
 * than changing the enum — the enum covers the four known teams; custom teams
 * use type = 'custom'.
 */
export const teams = pgTable("teams", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** Internal key: ne_germany | ne_france | ne_uk | ne_singapore | custom */
  key: text("key").notNull(),
  /** Display name, e.g. "N&E Germany" */
  name: text("name").notNull(),
  /** Optional person responsible for this team/market territory */
  responsiblePerson: text("responsible_person"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Team Members ─────────────────────────────────────────────────────────────

/**
 * Associates workspace users as members of a regional N&E team.
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("team_members_unique").on(table.teamId, table.userId),
  ]
);

// ─── Markets ──────────────────────────────────────────────────────────────────

/**
 * A market (country or region) that a team covers. When teamId is NULL the
 * market is managed directly by the person in responsiblePerson.
 */
export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Team that owns this market (nullable → covered by a person directly) */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Person responsible when no team is assigned */
    responsiblePerson: text("responsible_person"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("markets_workspace_name").on(table.workspaceId, table.name),
  ]
);

// ─── Trade Fairs ─────────────────────────────────────────────────────────────

export const tradeFairs = pgTable("trade_fairs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  location: text("location"),
  /** Country / region of the fair */
  country: text("country"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  /** Which team attended / managed this fair */
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Trade Fair ↔ Record relation ────────────────────────────────────────────

/**
 * Links any CRM record (Lead company, Person, Deal…) to a trade fair where
 * the contact was first encountered or where a deal was generated.
 */
export const tradeFairRecords = pgTable(
  "trade_fair_records",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tradeFairId: text("trade_fair_id")
      .notNull()
      .references(() => tradeFairs.id, { onDelete: "cascade" }),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trade_fair_records_unique").on(
      table.tradeFairId,
      table.recordId
    ),
  ]
);

// ─── Record ↔ Team relation ───────────────────────────────────────────────────

/**
 * Associates a CRM record (Lead, Customer, Deal) with one or more teams and
 * markets so that team-based filtering works without storing these as
 * free-text attributes.
 */
export const recordTeams = pgTable(
  "record_teams",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    marketId: text("market_id").references(() => markets.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("record_teams_unique").on(table.recordId, table.teamId),
  ]
);
