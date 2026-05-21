import { pgTable, text, timestamp, numeric, boolean, integer, date, pgEnum, index } from "drizzle-orm/pg-core";
import { records } from "./records";

export const lineItemTypeEnum = pgEnum("line_item_type", [
  "helper",
  "transporter",
  "other",
]);

export const quotations = pgTable(
  "quotations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    dealRecordId: text("deal_record_id")
      .notNull()
      .unique()
      .references(() => records.id, { onDelete: "cascade" }),
    fixedPrice: numeric("fixed_price", { precision: 12, scale: 2 }),
    isVariable: boolean("is_variable").notNull().default(false),
    notes: text("notes"),
    /**
     * If set, the customer portal gates Stage 2 (Auftragsbestätigung) on an
     * operator-confirmed payment >= this amount. Null = no Anzahlung required.
     */
    depositRequiredCents: integer("deposit_required_cents"),
    /**
     * Per-deal payment method shown to the customer at Stage 4 (and Stage 1
     * when a deposit is required). One of: bank_transfer | paypal | cash | card.
     * Null falls back to bank_transfer.
     */
    paymentMethodPreference: text("payment_method_preference"),
    /** ISO date — offer valid until. Optional. */
    validUntil: date("valid_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("quotations_deal_idx").on(table.dealRecordId)]
);

export const quotationLineItems = pgTable(
  "quotation_line_items",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    quotationId: text("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    type: lineItemTypeEnum("type").notNull().default("helper"),
    description: text("description"),
    quantity: integer("quantity").notNull().default(1),
    unitRate: numeric("unit_rate", { precision: 10, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("quotation_line_items_quotation_idx").on(table.quotationId)]
);
