import { pgTable, text, timestamp, numeric, boolean, integer, pgEnum, index } from "drizzle-orm/pg-core";
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
