import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspace";

export type RueckfrageStatus = "offen" | "beantwortet" | "abgelaufen";

/**
 * Rückfragen per WhatsApp an eine interne Nummer (Dario), gestellt von einem
 * Werkzeug außerhalb des CRM (Quelle, zum Beispiel "kassensturz"). Das CRM
 * speichert nur Fragetext, Kurzcode, Optionen, die Payload der Quelle und die
 * Antwort, keine Kontoauszüge. Ein Kurzcode ist je Workspace nur unter den
 * offenen Fragen eindeutig.
 */
export const internRueckfragen = pgTable(
  "intern_rueckfragen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    quelle: text("quelle").notNull(),
    code: text("code").notNull(),
    frage: text("frage").notNull(),
    optionen: jsonb("optionen").$type<string[]>().notNull().default([]),
    empfaenger: text("empfaenger").notNull(),
    status: text("status").$type<RueckfrageStatus>().notNull().default("offen"),
    antwort: text("antwort"),
    antwortVon: text("antwort_von"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    expiresAt: timestamp("expires_at").notNull(),
    sentAt: timestamp("sent_at"),
    answeredAt: timestamp("answered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("intern_rueckfragen_ws_status_idx").on(table.workspaceId, table.status),
    index("intern_rueckfragen_quelle_idx").on(table.workspaceId, table.quelle, table.answeredAt),
    uniqueIndex("intern_rueckfragen_offen_code_idx")
      .on(table.workspaceId, table.code)
      .where(sql`${table.status} = 'offen'`),
  ]
);
