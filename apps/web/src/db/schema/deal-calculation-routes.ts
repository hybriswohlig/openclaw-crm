import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { dealCalculationVersions } from "./deal-calculation-versions";

/** Eine Teilstrecke der Route (Station → Beladen → Entladen → Station). */
export interface RoutenTeilstrecke {
  von: string;
  nach: string;
  km: number;
  minuten: number;
  polyline: string;
  /** Beladen → Entladen; Stationswege sind false. */
  haupt: boolean;
}

/**
 * Route je Kalkulationsversion (Migration 0059), aus der Routes API.
 * `punkte_schluessel` = Hash aus Station, Beladen, Entladen: ein Entwurf holt
 * bei abweichendem Schlüssel neu, eine gesperrte Version behält ihre Punkte
 * und holt nach 30 Tagen mit denselben Punkten neu.
 */
export const dealCalculationRoutes = pgTable("deal_calculation_routes", {
  calculationVersionId: text("calculation_version_id")
    .primaryKey()
    .references(() => dealCalculationVersions.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  punkteSchluessel: text("punkte_schluessel").notNull(),
  teilstrecken: jsonb("teilstrecken").$type<RoutenTeilstrecke[]>().notNull(),
  googleLink: text("google_link").notNull(),
  berechnetAm: timestamp("berechnet_am", { withTimezone: true }).notNull(),
});

export type DealCalculationRouteRow = typeof dealCalculationRoutes.$inferSelect;
