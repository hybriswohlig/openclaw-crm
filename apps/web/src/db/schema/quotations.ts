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
     * Customer-facing free-text description of what the offer covers
     * (e.g. "Transport einer Waschmaschine von A nach B inkl. einem Helfer").
     * Shown prominently on the customer portal at Stage 1 when set.
     * Independent from `notes`, which is operator-internal.
     */
    summary: text("summary"),
    /**
     * Whether to render the Leistungsumfang block (baseline move inclusions
     * + auftrag conditional list) on the customer portal. Off for one-off
     * transports (laundry machine, piano-only) so the customer does not see
     * irrelevant items like "Decken" or "Halteverbot". Default true for
     * backward compatibility with existing rows; the calculator defaults
     * new transports to false.
     */
    showStandardInclusions: boolean("show_standard_inclusions")
      .notNull()
      .default(true),
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
    /**
     * Selected package slug from offer_packages for this operating company.
     * Customer portal shows it in the package selector as the chosen tier.
     * Null = no package picked, customer just sees the line items / fixed price.
     */
    selectedPackageSlug: text("selected_package_slug"),
    /**
     * Set when the customer picks one of the per-deal `quotation_package_options`
     * rows (operator-typed custom prices per Auftrag). Independent from
     * selectedPackageSlug: that one names the catalogue tier even after the
     * options table changes; this one points at the exact priced row the
     * customer committed to. Cleared by ON DELETE SET NULL when the operator
     * replaces the option set.
     */
    selectedPackageOptionId: text("selected_package_option_id"),
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
