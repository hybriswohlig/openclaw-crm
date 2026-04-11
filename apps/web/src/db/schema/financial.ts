import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  date,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { employees } from "./employees";

// ─── Enums ────────────────────────────────────────────────────────────────────

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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("expenses_deal_idx").on(table.dealRecordId),
    index("expenses_workspace_idx").on(table.workspaceId),
    index("expenses_date_idx").on(table.date),
    index("expenses_category_idx").on(table.category),
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
    status: employeeTransactionStatusEnum("status").notNull().default("open"),
    description: text("description"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("employee_transactions_deal_idx").on(table.dealRecordId),
    index("employee_transactions_employee_idx").on(table.employeeId),
    index("employee_transactions_workspace_idx").on(table.workspaceId),
    index("employee_transactions_status_idx").on(table.status),
  ]
);
