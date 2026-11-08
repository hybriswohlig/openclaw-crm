import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, numeric, index, integer, boolean, check, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { users } from "./auth";

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    experience: text("experience"),
    /** Abgeleitet aus `rate_work_cents` (Plan 12, E8); CHECK `employees_satz_abgeleitet`. */
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull(),
    /** Avatar image as base64 data URL (e.g. "data:image/png;base64,…"). Optional. */
    photoBase64: text("photo_base64"),
    /** Linked login account for the mobile employee portal. Null = no portal access. */
    userId: text("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    /**
     * Plan 12 (0064): PLZ und Ort, keine Straße. Nur für die Inhaber in
     * `/api/v1/einsatz/*`; nie in `listEmployees`, MCP, Portal oder Mitarbeiter-App.
     */
    homePlz: text("home_plz"),
    homeTown: text("home_town"),
    canDriveSprinter: boolean("can_drive_sprinter").notNull().default(false),
    ownCar: boolean("own_car").notNull().default(false),
    rateDriveCents: integer("rate_drive_cents").notNull().default(1500),
    /** Quelle des Satzes (E8); `hourly_rate` = rate_work_cents / 100. */
    rateWorkCents: integer("rate_work_cents").notNull().default(2000),
    /** Deaktivieren statt Löschen (Plan 12a Entscheidung 3). */
    active: boolean("active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("employees_workspace_idx").on(table.workspaceId),
    index("employees_user_idx").on(table.userId),
    check("employees_home_plz_format", sql`${table.homePlz} IS NULL OR ${table.homePlz} ~ '^[0-9]{5}$'`),
    check("employees_satz_abgeleitet", sql`${table.hourlyRate} = ${table.rateWorkCents} / 100.0`),
  ]
);

export const dealEmployees = pgTable(
  "deal_employees",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("helper"),
    /** Plan 12 (0064): geplante Minuten je Person; nur „Team bestätigen“ setzt sie. */
    plannedDriveMinutes: integer("planned_drive_minutes"),
    plannedWorkMinutes: integer("planned_work_minutes"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("deal_employees_deal_idx").on(table.dealRecordId),
    index("deal_employees_employee_idx").on(table.employeeId),
    uniqueIndex("deal_employees_deal_employee_uq").on(table.dealRecordId, table.employeeId),
  ]
);
