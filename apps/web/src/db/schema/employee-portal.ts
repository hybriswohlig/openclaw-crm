import {
  pgTable,
  pgEnum,
  text,
  integer,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { employees } from "./employees";
import { records } from "./records";
import { users } from "./auth";

// ─── Employee Portal: Zeiterfassung + Job-Medien ────────────────────────────────
// Tables backing the mobile employee portal (kottke-mitarbeiter.*). All additive;
// nothing in the existing CRM schema is touched.

// ── Time entries ──────────────────────────────────────────────────────────────
// One row per work session: a helper clocks in, takes breaks, clocks out, on a
// specific deal. status: open → submitted (helper done) → approved (operator
// signed off; only then may it become an employee_ledger earning).

export const employeeTimeEntryStatusEnum = pgEnum("employee_time_entry_status", [
  "open",
  "submitted",
  "approved",
]);

export const employeeTimeEntries = pgTable(
  "employee_time_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Optional: a free time entry not bound to a deal is allowed. */
    dealRecordId: text("deal_record_id").references(() => records.id, {
      onDelete: "set null",
    }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    startAt: timestamp("start_at").notNull(),
    /** Null while the session is still running. */
    endAt: timestamp("end_at"),
    breakMinutes: integer("break_minutes").notNull().default(0),
    status: employeeTimeEntryStatusEnum("status").notNull().default("open"),
    notes: text("notes"),
    /** Set once an approved entry has been turned into an employee_ledger earning. */
    ledgerEntryId: text("ledger_entry_id"),
    /** Operator who approved (user id). */
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ete_workspace_idx").on(t.workspaceId),
    index("ete_deal_idx").on(t.dealRecordId),
    index("ete_employee_idx").on(t.employeeId),
    index("ete_status_idx").on(t.status),
  ]
);

// ── Job media ─────────────────────────────────────────────────────────────────
// Photos/videos captured on the job, stored in a PRIVATE Vercel Blob store.
// The DB row holds only the blob reference + metadata; the binary lives in Blob.

export const jobMediaCategoryEnum = pgEnum("job_media_category", [
  "stairwell", // Treppenhaus (Video)
  "loading", // Sachen / Haus beim Einladen (Video/Foto)
  "overview", // Übersicht Wohnung/Haus
  "damage", // bereits beschädigte Sachen
  "truck_loaded", // alles im Transporter
  "final_loaded", // am Ende: wie alles verladen ist
  "receipt", // Beleg / Quittung
  "other",
]);

export const jobMedia = pgTable(
  "job_media",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id").references(() => records.id, {
      onDelete: "set null",
    }),
    employeeId: text("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    category: jobMediaCategoryEnum("category").notNull().default("other"),
    /** Pathname inside the private Blob store (used for get/del + authz). */
    blobPathname: text("blob_pathname").notNull(),
    /** The blob URL (private — only fetchable via the authed deliver route). */
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    etag: text("etag"),
    caption: text("caption"),
    capturedAt: timestamp("captured_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("job_media_workspace_idx").on(t.workspaceId),
    index("job_media_deal_idx").on(t.dealRecordId),
    index("job_media_employee_idx").on(t.employeeId),
    index("job_media_category_idx").on(t.category),
  ]
);
