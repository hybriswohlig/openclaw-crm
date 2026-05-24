import { pgTable, pgEnum, text, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";

export const employeeStatusEnum = pgEnum("employee_status", [
  "active",
  "on_leave",
  "inactive",
]);

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    experience: text("experience"),
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull(),
    /** Primary role label (e.g. "driver", "packer", "mover", "helper"). Free text. Optional. */
    role: text("role"),
    /** Employment status. Defaults to active so existing rows continue to surface in the dashboard. */
    status: employeeStatusEnum("status").notNull().default("active"),
    /** Avatar image as base64 data URL (e.g. "data:image/png;base64,…"). Optional. */
    photoBase64: text("photo_base64"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("employees_workspace_idx").on(table.workspaceId)]
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("deal_employees_deal_idx").on(table.dealRecordId),
    index("deal_employees_employee_idx").on(table.employeeId),
  ]
);
