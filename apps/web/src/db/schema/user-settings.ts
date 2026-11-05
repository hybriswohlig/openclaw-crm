import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Eine Zeile je Nutzer: welche Oberfläche aktiv ist und welche Ansichten
 * der Nutzer gespeichert hat. Ohne Zeile gilt `alt` und ein leeres Objekt.
 */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    uiVersion: text("ui_version").notNull().default("alt"),
    ansichten: jsonb("ansichten").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("user_settings_ui_version_check", sql`${table.uiVersion} in ('alt', 'neu')`),
  ]
);
