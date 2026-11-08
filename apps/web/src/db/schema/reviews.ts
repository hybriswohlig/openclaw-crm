import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

// review_events — append-only audit trail for the post-move reviews engine.
// Every state transition (scheduled, sent_sms, clicked, complaint_routed,
// suppressed, failed, reply_received, review_left, sent_whatsapp) writes a
// row so "why did this lead get/not get a message" is a single SQL query.
//
// deal_record_id is the lead/deal `records.id`. variant + channel are nullable
// because some events (e.g. suppressed before send) don't have them yet.
export const reviewEvents = pgTable(
  "review_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    variant: text("variant"),
    channel: text("channel"),
    meta: jsonb("meta").notNull().default({}),
    at: timestamp("at").notNull().defaultNow(),
  },
  (table) => [
    index("review_events_deal_idx").on(table.dealRecordId, table.at),
    index("review_events_workspace_idx").on(table.workspaceId, table.at),
    index("review_events_event_type_idx").on(table.workspaceId, table.eventType, table.at),
  ]
);

// review_tokens — opaque per-lead short-link tokens for the tracked review
// link. The /r/{token} endpoint looks up the row, logs the click, advances
// the deal's review_request_status, and 302s to destination_url.
export const reviewTokens = pgTable(
  "review_tokens",
  {
    token: text("token").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    destinationUrl: text("destination_url").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    clickedAt: timestamp("clicked_at"),
    clickUserAgent: text("click_user_agent"),
    clickIp: text("click_ip"),
    /**
     * Migration 0063 (Plan 11): anspruch = vor dem Senden angelegt, gesendet =
     * Versand bestätigt oder geklickt, unklar = Nachricht kann draußen sein.
     * Jeder Token sperrt ein neues Senden.
     */
    zustand: text("zustand").$type<"anspruch" | "gesendet" | "unklar">().notNull().default("anspruch"),
    zustandAt: timestamp("zustand_at", { withTimezone: true }),
    quelle: text("quelle").$type<"hand" | "vorgemerkt" | "automatik" | "alt">(),
  },
  (table) => [
    index("review_tokens_deal_idx").on(table.dealRecordId),
    index("review_tokens_zustand_idx").on(table.workspaceId, table.zustand),
    index("review_tokens_klickdaten_idx")
      .on(table.clickedAt)
      .where(sql`${table.clickIp} IS NOT NULL OR ${table.clickUserAgent} IS NOT NULL`),
    check("review_tokens_zustand_check", sql`${table.zustand} IN ('anspruch', 'gesendet', 'unklar')`),
    check(
      "review_tokens_quelle_check",
      sql`${table.quelle} IS NULL OR ${table.quelle} IN ('hand', 'vorgemerkt', 'automatik', 'alt')`
    ),
  ]
);

/**
 * review_vormerkungen (Migration 0063, Plan 11): eine offene Zeile je Deal.
 * hand = Knopf außerhalb der Ruhezeit, entwurf = Modus Entwurf (wartet auf
 * Freigabe, der Treiber sendet nie), auto = Modus Senden (Treiber sendet im
 * nächsten Fenster). Gesendet wird immer über `bewertungAnfragen`.
 */
export const reviewVormerkungen = pgTable(
  "review_vormerkungen",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    operatingCompanyRecordId: text("operating_company_record_id"),
    art: text("art").$type<"hand" | "entwurf" | "auto">().notNull(),
    status: text("status").$type<"offen" | "gesendet" | "verworfen" | "gesperrt">().notNull().default("offen"),
    faelligAb: timestamp("faellig_ab", { withTimezone: true }).notNull(),
    fristBis: timestamp("frist_bis", { withTimezone: true }).notNull(),
    text: text("text"),
    einwilligung: text("einwilligung"),
    erstelltVon: text("erstellt_von"),
    sperre: text("sperre"),
    versuche: integer("versuche").notNull().default(0),
    letzterVersuchAt: timestamp("letzter_versuch_at", { withTimezone: true }),
    erledigtAt: timestamp("erledigt_at", { withTimezone: true }),
    erledigtVon: text("erledigt_von"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("review_vormerkungen_offen_uniq")
      .on(table.workspaceId, table.dealRecordId)
      .where(sql`${table.status} = 'offen'`),
    index("review_vormerkungen_faellig_idx").on(table.status, table.faelligAb),
    check("review_vormerkungen_art_check", sql`${table.art} IN ('hand', 'entwurf', 'auto')`),
    check("review_vormerkungen_status_check", sql`${table.status} IN ('offen', 'gesendet', 'verworfen', 'gesperrt')`),
  ]
);
