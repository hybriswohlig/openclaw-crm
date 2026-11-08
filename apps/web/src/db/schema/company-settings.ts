import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    /** Zahlungsregel (Migration 0062, Plan 9). */
    zahlungszielBasis: text("zahlungsziel_basis").$type<"umzugstag" | "rechnungstag">().notNull().default("umzugstag"),
    zahlungszielTage: integer("zahlungsziel_tage").notNull().default(0),
    erinnerungModus: text("erinnerung_modus").$type<"aus" | "entwurf">().notNull().default("aus"),
    erinnerungTage: integer("erinnerung_tage").notNull().default(7),
    erinnerung2Tage: integer("erinnerung2_tage").notNull().default(14),
    /** Steuernummer für die Rechnung (leer zulässig; Ceylan-PDF druckt sie nur, wenn gesetzt). */
    steuernummer: text("steuernummer"),
    /** Bewertungs-Automatik (Migration 0063, Plan 11). Ohne Zeile gilt „aus“. */
    bewertungModus: text("bewertung_modus").$type<"aus" | "entwurf" | "senden">().notNull().default("aus"),
    /** Zuletzt von „aus“ weg geschaltet; Anker davor zählen nie (Altaufträge). */
    bewertungModusSeit: timestamp("bewertung_modus_seit", { withTimezone: true }),
    /** Einwilligungs-Haken bei der Annahme im Portal (kundensichtbar, Standard aus). */
    bewertungHakenPortal: boolean("bewertung_haken_portal").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("company_settings_rechner_marke_check", sql`${table.rechnerMarke} in ('kottke', 'ceylan')`),
    check("company_settings_zahlungsziel_basis_check", sql`${table.zahlungszielBasis} IN ('umzugstag', 'rechnungstag')`),
    check("company_settings_zahlungsziel_tage_check", sql`${table.zahlungszielTage} BETWEEN 0 AND 60`),
    check("company_settings_erinnerung_modus_check", sql`${table.erinnerungModus} IN ('aus', 'entwurf')`),
    check("company_settings_erinnerung_tage_check", sql`${table.erinnerungTage} BETWEEN 1 AND 60`),
    check("company_settings_erinnerung2_tage_check", sql`${table.erinnerung2Tage} BETWEEN 1 AND 60`),
    check("company_settings_bewertung_modus_check", sql`${table.bewertungModus} IN ('aus', 'entwurf', 'senden')`),
  ]
);

export type CompanySettingsRow = typeof companySettings.$inferSelect;
