import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { records } from "./records";
import { dealDocuments } from "./financial";
import type { ErinnerungStatus, RechnungHerkunft, RechnungStatus } from "@/lib/geld";

/**
 * Rechnung als Datensatz (Migration 0062, Plan 9). Das PDF bleibt in
 * `deal_documents`; diese Zeile trägt Nummer, Betrag, Fälligkeit und Status.
 * Höchstens eine aktive Rechnung (`entwurf` oder `gestellt`) je Deal.
 */
export const dealInvoices = pgTable(
  "deal_invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull(),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    operatingCompanyId: text("operating_company_id").references(() => records.id, { onDelete: "set null" }),
    nummer: text("nummer"),
    jahr: integer("jahr"),
    laufnummer: integer("laufnummer"),
    herkunft: text("herkunft").$type<RechnungHerkunft>().notNull(),
    status: text("status").$type<RechnungStatus>().notNull(),
    bruttoCent: integer("brutto_cent"),
    rechnungstag: date("rechnungstag"),
    faelligAm: date("faellig_am"),
    abweichungGrund: text("abweichung_grund"),
    dealDocumentId: text("deal_document_id").references(() => dealDocuments.id, { onDelete: "set null" }),
    renderJobId: text("render_job_id"),
    stornoGrund: text("storno_grund"),
    storniertAm: timestamp("storniert_am", { withTimezone: true }),
    storniertVon: text("storniert_von"),
    verworfenGrund: text("verworfen_grund"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deal_invoices_herkunft_check", sql`${t.herkunft} IN ('crm', 'vps', 'upload', 'alt')`),
    check("deal_invoices_status_check", sql`${t.status} IN ('entwurf', 'gestellt', 'storniert', 'verworfen')`),
    check("deal_invoices_brutto_check", sql`${t.bruttoCent} IS NULL OR ${t.bruttoCent} >= 0`),
    uniqueIndex("deal_invoices_nummer_uniq")
      .on(t.workspaceId, t.operatingCompanyId, t.nummer)
      .where(sql`${t.nummer} IS NOT NULL`),
    uniqueIndex("deal_invoices_aktiv_uniq")
      .on(t.dealRecordId)
      .where(sql`${t.status} IN ('entwurf', 'gestellt')`),
    uniqueIndex("deal_invoices_dokument_uniq")
      .on(t.dealDocumentId)
      .where(sql`${t.dealDocumentId} IS NOT NULL`),
    index("deal_invoices_status_idx").on(t.workspaceId, t.status, t.faelligAm),
  ]
);

export type DealInvoiceRow = typeof dealInvoices.$inferSelect;

/** Zahlungserinnerung je Rechnung und Stufe (Entwurf zur Freigabe). */
export const paymentReminders = pgTable(
  "payment_reminders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull(),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => dealInvoices.id, { onDelete: "cascade" }),
    stufe: smallint("stufe").$type<1 | 2>().notNull(),
    faelligAm: date("faellig_am").notNull(),
    restCent: integer("rest_cent").notNull(),
    status: text("status").$type<ErinnerungStatus>().notNull().default("entwurf"),
    kanal: text("kanal"),
    draftId: text("draft_id"),
    stoppGrund: text("stopp_grund"),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payment_reminders_stufe_check", sql`${t.stufe} IN (1, 2)`),
    check("payment_reminders_status_check", sql`${t.status} IN ('entwurf', 'gesendet', 'verworfen', 'gestoppt')`),
    uniqueIndex("payment_reminders_stufe_uniq").on(t.invoiceId, t.stufe),
    index("payment_reminders_deal_idx").on(t.workspaceId, t.dealRecordId),
  ]
);

export type PaymentReminderRow = typeof paymentReminders.$inferSelect;
