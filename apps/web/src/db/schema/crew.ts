import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { employees } from "./employees";

/**
 * Crew-Portal (Migration 0066). Vertrag: `lib/crew/contract.ts`.
 *
 * Persönlicher Link je Mitarbeiter. Der Token steht im Klartext wie bei
 * `customer_status_links`, damit das Büro den Link jederzeit erneut kopieren
 * kann. „Neuer Link“ setzt einen neuen Token auf dieselbe Zeile (alter Token
 * sofort tot), Sperren setzt `revoked_at`.
 */
export const crewLinks = pgTable(
  "crew_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** 32 Zeichen base64url (192 Bit), `generateToken` aus customer-portal-core. */
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Höchstens einmal je Minute fortgeschrieben (`requireCrew`). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("crew_links_employee_uq").on(t.employeeId),
    uniqueIndex("crew_links_token_uq").on(t.token),
    index("crew_links_workspace_idx").on(t.workspaceId),
    check("crew_links_token_format", sql`${t.token} ~ '^[A-Za-z0-9_-]{32}$'`),
    check("crew_links_view_count_check", sql`${t.viewCount} >= 0`),
  ]
);

export type CrewAntwortGespeichert = "ja" | "vielleicht" | "nein" | "warteliste";

/**
 * Antwort einer Person auf einen Job. „ja“ ist eine Anfrage, keine Einteilung;
 * eingeteilt wird nur über `deal_employees` (Einsatz-Dialog).
 */
export const crewJobResponses = pgTable(
  "crew_job_responses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    answer: text("answer").$type<CrewAntwortGespeichert>().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").$type<"portal" | "crm">().notNull().default("portal"),
  },
  (t) => [
    uniqueIndex("crew_job_responses_deal_employee_uq").on(t.dealRecordId, t.employeeId),
    index("crew_job_responses_workspace_deal_idx").on(t.workspaceId, t.dealRecordId),
    index("crew_job_responses_employee_idx").on(t.employeeId),
    check("crew_job_responses_answer_check", sql`${t.answer} IN ('ja', 'vielleicht', 'nein', 'warteliste')`),
    check("crew_job_responses_source_check", sql`${t.source} IN ('portal', 'crm')`),
  ]
);

/**
 * Briefing-Freigabe je Deal (Migration 0067). Zeile da und `withdrawnAt` leer =
 * das eingeteilte Team sieht das Briefing. „Erneut freigeben“ setzt `releasedAt` neu.
 */
export const crewBriefings = pgTable(
  "crew_briefings",
  {
    dealRecordId: text("deal_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
    releasedBy: text("released_by"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [index("crew_briefings_workspace_idx").on(t.workspaceId)]
);

/** „Gelesen“ je Person und Freigabe (`releaseAt` = `crew_briefings.released_at` beim Lesen). */
export const crewBriefingReads = pgTable(
  "crew_briefing_reads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crew_briefing_reads_uq").on(t.dealRecordId, t.employeeId, t.releaseAt)]
);

export type CrewNachrichtStatus = "gesendet" | "fehler" | "kein_telefon" | "kein_link" | "kein_absender";

/** Jeder WhatsApp-Versuch an die Crew, auch übersprungene. */
export const crewNotifications = pgTable(
  "crew_notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"briefing">().notNull(),
    /** Freigabe (`crew_briefings.released_at`), zu der dieser Versand gehört. */
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    status: text("status").$type<CrewNachrichtStatus>().notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [
    index("crew_notifications_deal_idx").on(t.dealRecordId, t.employeeId, t.releaseAt),
    check("crew_notifications_kind_check", sql`${t.kind} IN ('briefing')`),
    check(
      "crew_notifications_status_check",
      sql`${t.status} IN ('gesendet', 'fehler', 'kein_telefon', 'kein_link', 'kein_absender')`
    ),
  ]
);
