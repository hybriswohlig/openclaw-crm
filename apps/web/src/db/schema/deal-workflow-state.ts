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
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("deal_workflow_state_waiting_on_check", sql`${table.waitingOn} in ('uns', 'kunde', 'niemand')`),
  ]
);
