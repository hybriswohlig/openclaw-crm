import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspace";
import { records } from "./records";
import { employees } from "./employees";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const dealDocumentTypeEnum = pgEnum("deal_document_type", [
  "order_confirmation",
  "invoice",
  "payment_confirmation",
]);

export const expenseCategoryEnum = pgEnum("expense_category", [
  "fuel",
  "truck_rental",
  "equipment",
  "subcontractor",
  "toll",
  "other",
]);

export const employeeTransactionTypeEnum = pgEnum("employee_transaction_type", [
  "salary",
  "advance",
  "reimbursement",
]);

export const employeeTransactionStatusEnum = pgEnum(
  "employee_transaction_status",
  ["open", "paid"]
);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "bank_transfer",
  "other",
]);

export const privateTransactionDirectionEnum = pgEnum(
  "private_transaction_direction",
  ["einlage", "entnahme"]
);

// ─── Deal Number Sequences ─────────────────────────────────────────────────────
// Tracks the next available sequence number per workspace per year.
// Atomically incremented on each deal creation.

export const dealNumberSequences = pgTable(
  "deal_number_sequences",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    lastSequence: integer("last_sequence").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.year] })]
);

// ─── Deal Numbers ──────────────────────────────────────────────────────────────
// The canonical human-readable number for a deal, e.g. "2025-003".
// One row per deal, auto-assigned on deal creation.

export const dealNumbers = pgTable(
  "deal_numbers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .unique()
      .references(() => records.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    sequence: integer("sequence").notNull(),
    dealNumber: text("deal_number").notNull(), // e.g. "2025-003"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("deal_numbers_workspace_year_seq_idx").on(
      table.workspaceId,
      table.year,
      table.sequence
    ),
    index("deal_numbers_deal_record_idx").on(table.dealRecordId),
    index("deal_numbers_workspace_idx").on(table.workspaceId),
  ]
);

// ─── Payments ──────────────────────────────────────────────────────────────────
// Income received from clients for a specific deal.
// A deal can have multiple payment installments.

export const payments = pgTable(
  "payments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    payer: text("payer"),
    paymentMethod: text("payment_method"),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("payments_deal_idx").on(table.dealRecordId),
    index("payments_workspace_idx").on(table.workspaceId),
    index("payments_date_idx").on(table.date),
  ]
);

// ─── Expenses ─────────────────────────────────────────────────────────────────
// All outgoing costs tied to a deal: fuel, truck rental, equipment, etc.
// dealRecordId is required — all costs belong to a deal.

export const expenses = pgTable(
  "expenses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    category: expenseCategoryEnum("category").notNull().default("other"),
    description: text("description"),
    recipient: text("recipient"),
    paymentMethod: text("payment_method"),
    receiptFile: text("receipt_file"),
    /** true = steuerlich absetzbar, false = privat/nicht absetzbar */
    isTaxDeductible: boolean("is_tax_deductible").notNull().default(true),
    /** When set, another operating company's cash paid this expense — Quersubvention. */
    payingOperatingCompanyId: text("paying_operating_company_id").references(
      () => records.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("expenses_deal_idx").on(table.dealRecordId),
    index("expenses_workspace_idx").on(table.workspaceId),
    index("expenses_date_idx").on(table.date),
    index("expenses_category_idx").on(table.category),
    index("expenses_paying_company_idx").on(table.payingOperatingCompanyId),
  ]
);

// ─── Employee Transactions ────────────────────────────────────────────────────
// Salary payments, advances, and reimbursements per employee per deal.
// All employee costs are deal-specific (no fixed overhead).

export const employeeTransactions = pgTable(
  "employee_transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    type: employeeTransactionTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Cumulative paid so far. Status is derived: 0 → offen, < amount → teilweise bezahlt, ≥ amount → bezahlt. */
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
    /** When the transaction is due to be paid. Optional. */
    dueDate: date("due_date"),
    status: employeeTransactionStatusEnum("status").notNull().default("open"),
    description: text("description"),
    notes: text("notes"),
    /** How the employee was paid. Nullable = unknown / not yet paid. */
    paymentMethod: paymentMethodEnum("payment_method"),
    /** true = steuerlich absetzbar, false = nicht absetzbar */
    isTaxDeductible: boolean("is_tax_deductible").notNull().default(true),
    /** When set, another operating company's cash paid this employee — Quersubvention. */
    payingOperatingCompanyId: text("paying_operating_company_id").references(
      () => records.id,
      { onDelete: "set null" }
    ),
    /** Receipt / invoice file as base64 data URL (e.g. "data:image/jpeg;base64,…"). */
    receiptFile: text("receipt_file"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("employee_transactions_deal_idx").on(table.dealRecordId),
    index("employee_transactions_employee_idx").on(table.employeeId),
    index("employee_transactions_workspace_idx").on(table.workspaceId),
    index("employee_transactions_status_idx").on(table.status),
    index("employee_transactions_paying_company_idx").on(
      table.payingOperatingCompanyId
    ),
  ]
);

// ─── Deal Documents ───────────────────────────────────────────────────────────
// File attachments for a deal: Auftragsbestätigung, Rechnung, Zahlungsbestätigung.
// File content is stored as base64 text (suitable for documents up to ~5 MB).

export const dealDocuments = pgTable(
  "deal_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    documentType: dealDocumentTypeEnum("document_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(), // bytes
    mimeType: text("mime_type").notNull(),
    fileContent: text("file_content").notNull(), // base64
    uploadedAt: timestamp("uploaded_at").notNull().default(sql`now()`),
  },
  (table) => [
    index("deal_documents_deal_idx").on(table.dealRecordId),
    index("deal_documents_workspace_idx").on(table.workspaceId),
    index("deal_documents_type_idx").on(table.documentType),
  ]
);

// ─── Private Transactions ─────────────────────────────────────────────────────
// Partner-level private money movements that bypass a deal:
//   - Privatentnahme: partner takes money out of a company's pot
//   - Privateinlage: partner pays something for the business out of their own pocket
// Always standalone (no deal link). Tied to one operating company.

export const privateTransactions = pgTable(
  "private_transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    method: paymentMethodEnum("method").notNull().default("cash"),
    /** Partner whose money it is (paying partner). */
    fromPartner: text("from_partner").notNull(),
    /** Partner who received the money. Null = paid "on his own" / into the business. */
    toPartner: text("to_partner"),
    /** Which operating company's pot this movement belongs to. */
    operatingCompanyId: text("operating_company_id")
      .notNull()
      .references(() => records.id, { onDelete: "restrict" }),
    direction: privateTransactionDirectionEnum("direction").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("private_transactions_workspace_idx").on(table.workspaceId),
    index("private_transactions_date_idx").on(table.date),
    index("private_transactions_company_idx").on(table.operatingCompanyId),
  ]
);
