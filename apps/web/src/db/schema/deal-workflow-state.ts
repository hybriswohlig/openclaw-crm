import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { records } from "./records";

/**
 * Eine Zeile je Deal: auf wen er wartet (uns, Kunde, niemand), seit wann und
 * warum, dazu die Zeitstempel, die das Wartet-Signal und die Stufenanzeige
 * brauchen. Geschrieben von services/wartet.ts, nachts neu berechnet.
 */
export const dealWorkflowState = pgTable(
  "deal_workflow_state",
  {
    recordId: text("record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    waitingOn: text("waiting_on").$type<"uns" | "kunde" | "niemand">().notNull().default("niemand"),
    waitingSince: timestamp("waiting_since"),
    waitingReason: text("waiting_reason"),
    lastOutboundHumanAt: timestamp("last_outbound_human_at"),
    lastInboundAt: timestamp("last_inbound_at"),
    stageEnteredAt: timestamp("stage_entered_at"),
    /** Voll bezahlt mit gestellter Rechnung (Plan 9, `abschlussAus`); Anker der Bewertung (Plan 11). */
    bezahltAm: timestamp("bezahlt_am", { withTimezone: true }),
    /** Plan 15 (Bauteil 15): „Pakete anbieten“ je Deal; null = Firmenstandard (`angebot_aus_kalkulation`). */
    paketeAnbieten: text("pakete_anbieten").$type<"an" | "aus" | null>(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("deal_workflow_state_waiting_on_check", sql`${table.waitingOn} in ('uns', 'kunde', 'niemand')`),
    check("deal_workflow_state_pakete_anbieten_check", sql`${table.paketeAnbieten} IS NULL OR ${table.paketeAnbieten} IN ('an', 'aus')`),
  ]
);
