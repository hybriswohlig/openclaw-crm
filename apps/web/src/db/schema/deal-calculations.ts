import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

// ─── Kalkulation je Lead (Umzugsgut-Angebotsrechner) ─────────────────────────
// Eine Zeile je Lead: letzte Rechner-Anfrage (`request`), deren Fingerabdruck
// (`input_hash`, damit unveränderte Eingaben keine neue Rechnung auslösen),
// das letzte erfolgreiche Ergebnis (`result`) und ein eventueller Fehler der
// jüngsten Rechnung (`error`). Angelegt über
// src/db/migrate-2026-09-27-deal-calculations.ts.
export const dealCalculations = pgTable(
  "deal_calculations",
  {
    dealRecordId: text("deal_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    request: jsonb("request").notNull(),
    result: jsonb("result"),
    error: text("error"),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (t) => [index("deal_calculations_workspace_idx").on(t.workspaceId)]
);
