import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { records } from "./records";

/**
 * Einstellungen je Betriebsfirma (Migration 0057): Zeitposten-Bibliothek für
 * die Kalkulation und die Rechner-Marke (Tarif). Ohne Zeile gilt: keine
 * Zeitposten, Marke aus dem Firmennamen.
 */
export const companySettings = pgTable(
  "company_settings",
  {
    operatingCompanyRecordId: text("operating_company_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    zeitposten: jsonb("zeitposten").$type<unknown[]>().notNull().default([]),
    rechnerMarke: text("rechner_marke").$type<"kottke" | "ceylan">(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("company_settings_rechner_marke_check", sql`${table.rechnerMarke} in ('kottke', 'ceylan')`),
  ]
);

export type CompanySettingsRow = typeof companySettings.$inferSelect;
