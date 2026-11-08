import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { records } from "./records";

/**
 * Kalkulationsversionen je Deal (Migration 0057). Höchstens ein Entwurf je
 * Deal (Teil-Unique `deal_calculation_versions_ein_entwurf`); gesperrte
 * Versionen bleiben unverändert und sind die Quelle des KV
 * (`quotations.calculation_version_id`). `rechner_request`/`rechner_result`
 * sind der vollständige Schnappschuss des Rechners, `reference_date` das feste
 * Berliner Datum der Berechnung. Die jsonb-Felder typisiert der
 * Versionen-Dienst (`VersionsZeile`).
 */
export const dealCalculationVersions = pgTable(
  "deal_calculation_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull(),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").$type<"entwurf" | "gesperrt">().notNull().default("entwurf"),
    pricingMode: text("pricing_mode").$type<"fest" | "stunden">().notNull().default("fest"),
    referenceDate: date("reference_date").notNull(),
    inputs: jsonb("inputs").$type<unknown[]>().notNull().default([]),
    overrides: jsonb("overrides").$type<unknown[]>().notNull().default([]),
    rechnerRequest: jsonb("rechner_request"),
    rechnerResult: jsonb("rechner_result"),
    error: text("error"),
    costLines: jsonb("cost_lines").$type<unknown[]>().notNull().default([]),
    margin: jsonb("margin"),
    priceCents: integer("price_cents"),
    packagePrices: jsonb("package_prices").$type<unknown[]>().notNull().default([]),
    /** Plan 5b (Migration 0061): `Tagespreis[]` aus lib/angebot-wahl.ts. */
    dayPrices: jsonb("day_prices").$type<unknown[]>().notNull().default([]),
    kvItems: jsonb("kv_items").$type<unknown[]>().notNull().default([]),
    tariff: jsonb("tariff"),
    /** Plan 12b (0064): FK auf `vehicle_bookings(id)` ON DELETE SET NULL (nur in der Migration). */
    vehicleBookingId: text("vehicle_booking_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),
    sentAt: timestamp("sent_at"),
    sentVia: text("sent_via"),
  },
  (table) => [
    check("deal_calculation_versions_status_check", sql`${table.status} in ('entwurf', 'gesperrt')`),
    check("deal_calculation_versions_pricing_mode_check", sql`${table.pricingMode} in ('fest', 'stunden')`),
    uniqueIndex("deal_calculation_versions_deal_version_unique").on(table.dealRecordId, table.version),
    uniqueIndex("deal_calculation_versions_ein_entwurf")
      .on(table.dealRecordId)
      .where(sql`${table.status} = 'entwurf'`),
    index("deal_calculation_versions_workspace_deal_idx").on(table.workspaceId, table.dealRecordId),
  ]
);

export type DealCalculationVersionRow = typeof dealCalculationVersions.$inferSelect;
