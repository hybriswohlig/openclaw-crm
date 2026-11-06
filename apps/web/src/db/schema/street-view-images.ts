import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Street-View-Bild je Workspace und normalisierter Adresse (Migration 0059).
 * Bild privat im Blob unter `blob_pfad`, höchstens 30 Tage gültig; dauerhaft
 * bleibt nur `pano_id`. "kein_bild" wird 30 Tage gemerkt, "fehler"
 * frühestens nach 1 Stunde neu versucht.
 */
export const streetViewImages = pgTable(
  "street_view_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull(),
    adresseSchluessel: text("adresse_schluessel").notNull(),
    adresse: text("adresse").notNull(),
    status: text("status").$type<"ok" | "kein_bild" | "fehler">().notNull(),
    blobPfad: text("blob_pfad"),
    panoId: text("pano_id"),
    geholtAm: timestamp("geholt_am", { withTimezone: true }).notNull(),
    notiz: text("notiz"),
    notizVon: text("notiz_von").references(() => users.id, { onDelete: "set null" }),
    notizAm: timestamp("notiz_am", { withTimezone: true }),
  },
  (table) => [
    check("street_view_images_status_check", sql`${table.status} in ('ok', 'kein_bild', 'fehler')`),
    uniqueIndex("street_view_images_ws_adresse_unique").on(table.workspaceId, table.adresseSchluessel),
  ]
);

export type StreetViewImageRow = typeof streetViewImages.$inferSelect;
