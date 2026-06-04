import {
  pgTable,
  pgEnum,
  text,
  numeric,
  date,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { employees } from "./employees";
import { records } from "./records";

// ─── Employee Ledger ───────────────────────────────────────────────────────────
// Unified, double-direction money ledger per employee. Replaces the
// amount/amount_paid conflation of `employee_transactions` with one row per
// real money event:
//
//   - earning      → der Mitarbeiter hat verdient (Lohn). Erhöht den Saldo
//                    (wir schulden ihm). Optional an einen Auftrag gebunden.
//   - reimbursement→ der Mitarbeiter hat etwas ausgelegt (z.B. Sprit) und reicht
//                    einen Beleg ein. Erhöht ebenfalls den Saldo.
//   - payment      → wir haben an den Mitarbeiter ausgezahlt. Senkt den Saldo.
//                    Kann frei (ohne Auftrag) erfolgen.
//   - in_kind      → Sachbezug / geldwerte Leistung. Wir haben dem Mitarbeiter
//                    etwas gekauft (Werkzeug, Schuhe, Material) und verrechnen es
//                    gegen den Lohn. Wie eine Auszahlung in Waren statt Bar →
//                    senkt den Saldo. Optionaler Kaufbeleg.
//
// Saldo (was wir dem Mitarbeiter schulden) pro Firma
//   = Σ(earning + reimbursement, C) − Σ(payment + in_kind, C).
//
// Company attribution mirrors expenses/employee_transactions:
//   - operating_company_id     → die Firma, deren "Konto" der Eintrag betrifft
//                                (Auftragsfirma bei Verdiensten, Schuld-Firma bei
//                                Auszahlungen). Für die 50/50-Logik die Auftragsfirma.
//   - paying_operating_company_id → wenn eine andere Firma den Betrag trägt/zahlt
//                                (Quersubvention). Fließt in den 50/50-Ausgleich ein.

export const employeeLedgerKindEnum = pgEnum("employee_ledger_kind", [
  "earning",
  "reimbursement",
  "payment",
  "in_kind",
]);

export const employeeLedger = pgTable(
  "employee_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    /** earning / reimbursement = credit (+Saldo), payment / in_kind = debit (−Saldo). */
    kind: employeeLedgerKindEnum("kind").notNull(),
    /** Always positive. The sign is implied by `kind`. */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Firma, deren Konto der Eintrag betrifft (Auftragsfirma / Schuld-Firma). */
    operatingCompanyId: text("operating_company_id").references(
      () => records.id,
      { onDelete: "set null" }
    ),
    /** Quersubvention: wenn eine andere Firma den Betrag trägt/zahlt. */
    payingOperatingCompanyId: text("paying_operating_company_id").references(
      () => records.id,
      { onDelete: "set null" }
    ),
    /** Optionaler Auftragsbezug. Null = freie Buchung. */
    dealRecordId: text("deal_record_id").references(() => records.id, {
      onDelete: "set null",
    }),
    /** Zahlungsart (vor allem für payments). */
    paymentMethod: text("payment_method"),
    description: text("description"),
    notes: text("notes"),
    /** true = steuerlich absetzbar, false = nicht absetzbar. */
    isTaxDeductible: boolean("is_tax_deductible").notNull().default(true),
    /** Fälligkeit für noch offene Verdienste/Erstattungen. Optional. */
    dueDate: date("due_date"),
    /** Beleg / Rechnung als base64 data URL (z.B. Sprit-Quittung). */
    receiptFile: text("receipt_file"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("employee_ledger_workspace_idx").on(table.workspaceId),
    index("employee_ledger_employee_idx").on(table.employeeId),
    index("employee_ledger_deal_idx").on(table.dealRecordId),
    index("employee_ledger_company_idx").on(table.operatingCompanyId),
    index("employee_ledger_paying_company_idx").on(
      table.payingOperatingCompanyId
    ),
    index("employee_ledger_kind_idx").on(table.kind),
    index("employee_ledger_date_idx").on(table.date),
  ]
);
