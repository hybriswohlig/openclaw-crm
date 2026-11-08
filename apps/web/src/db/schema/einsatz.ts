import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { employees } from "./employees";

/**
 * Plan 12 (Migration 0064): Verfügbarkeit als Ausnahme, Kilometer-Cache,
 * Kartenpunkte und Transporter-Buchungen. Tage sind Berliner Kalendertage.
 * Typen der Fachseite stehen in `lib/einsatz.ts`.
 */
export const employeeAbsences = pgTable(
  "employee_absences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    von: date("von").notNull(),
    bis: date("bis").notNull(),
    art: text("art").$type<"urlaub" | "krank" | "gesperrt">().notNull(),
    notiz: text("notiz"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("employee_absences_art_check", sql`${table.art} IN ('urlaub', 'krank', 'gesperrt')`),
    check("employee_absences_zeitraum_check", sql`${table.bis} >= ${table.von}`),
    index("employee_absences_workspace_zeitraum_idx").on(table.workspaceId, table.von, table.bis),
    index("employee_absences_employee_idx").on(table.employeeId),
  ]
);

/**
 * Kilometer je Wohnort und Kundenadresse (I3). Bewusst ohne `employee_id` und
 * ohne Minuten: der Cache kennt nur Orte und Adressen, keine Personen und
 * keinen Verkehr. Zeilen älter als `WEG_GUELTIG_TAGE` gelten als leer.
 */
export const einsatzWege = pgTable(
  "einsatz_wege",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ortSchluessel: text("ort_schluessel").notNull(),
    adresseSchluessel: text("adresse_schluessel").notNull(),
    km: numeric("km", { precision: 7, scale: 1 }).notNull(),
    berechnetAm: timestamp("berechnet_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.ortSchluessel, table.adresseSchluessel] }),
    check("einsatz_wege_km_check", sql`${table.km} >= 0`),
  ]
);

/** Kartenpunkte je Ort (12c), ohne Personenbezug, 30 Tage gültig. */
export const einsatzOrte = pgTable(
  "einsatz_orte",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ortSchluessel: text("ort_schluessel").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    berechnetAm: timestamp("berechnet_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.ortSchluessel] })]
);

/**
 * Transporter-Buchung von Hand je Firma (12b, E5). Station und Klasse als ID
 * plus Kopie aus dem Rechner. Nie gelöscht, nur storniert.
 */
export const vehicleBookings = pgTable(
  "vehicle_bookings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operatingCompanyRecordId: text("operating_company_record_id")
      .notNull()
      .references(() => records.id),
    von: date("von").notNull(),
    bis: date("bis").notNull(),
    stationId: text("station_id").notNull(),
    stationName: text("station_name").notNull(),
    stationAnbieter: text("station_anbieter"),
    klasseId: text("klasse_id").notNull(),
    klasseName: text("klasse_name").notNull(),
    mieteCents: integer("miete_cents").notNull(),
    inklusivKm: integer("inklusiv_km"),
    mehrkmSatzCents: integer("mehrkm_satz_cents"),
    geplanteAuftraege: integer("geplante_auftraege").notNull().default(1),
    status: text("status").$type<"geplant" | "bestaetigt" | "storniert">().notNull().default("geplant"),
    notiz: text("notiz"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("vehicle_bookings_miete_check", sql`${table.mieteCents} >= 0`),
    check("vehicle_bookings_auftraege_check", sql`${table.geplanteAuftraege} BETWEEN 1 AND 20`),
    check("vehicle_bookings_status_check", sql`${table.status} IN ('geplant', 'bestaetigt', 'storniert')`),
    check("vehicle_bookings_zeitraum_check", sql`${table.bis} >= ${table.von}`),
    index("vehicle_bookings_workspace_zeitraum_idx").on(table.workspaceId, table.von, table.bis),
  ]
);

/** Zuordnung Auftrag → Buchung; ein Deal hängt an höchstens einer Buchung. */
export const dealVehicleBookings = pgTable(
  "deal_vehicle_bookings",
  {
    dealRecordId: text("deal_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    bookingId: text("booking_id")
      .notNull()
      .references(() => vehicleBookings.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    geschaetzteKm: integer("geschaetzte_km"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("deal_vehicle_bookings_booking_idx").on(table.bookingId)]
);
