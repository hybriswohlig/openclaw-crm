import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { records } from "./records";
import { dealCalculationVersions } from "./deal-calculation-versions";
import { dealDocuments } from "./financial";
import { dealInvoices } from "./deal-invoices";

/**
 * Register der VPS-Dokumentjobs (Migration 0060). `POST /api/tools/run` legt
 * je Job eine Zeile an; Browser oder Cron schließen ab (`kvJobAbschliessen`).
 * Beim KV trägt die Zeile die Version und den Preis aus genau der Lesung, aus
 * der die Preise an den VPS gingen. Jede Abfrage filtert nach `workspace_id`.
 */
export const documentRenderJobs = pgTable(
  "document_render_jobs",
  {
    vpsJobId: text("vps_job_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    calculationVersionId: text("calculation_version_id").references(() => dealCalculationVersions.id, {
      onDelete: "set null",
    }),
    priceCents: integer("price_cents"),
    status: text("status", { enum: ["laeuft", "abgelegt", "verworfen", "fehler"] }).notNull().default("laeuft"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    storedAt: timestamp("stored_at", { withTimezone: true }),
    dealDocumentId: text("deal_document_id").references(() => dealDocuments.id, { onDelete: "set null" }),
    fehler: text("fehler"),
    /** Rechnungsdatensatz, den dieser Job rendert (Plan 9). */
    invoiceId: text("invoice_id").references(() => dealInvoices.id, { onDelete: "set null" }),
  },
  (t) => [
    index("document_render_jobs_status_idx").on(t.status, t.createdAt),
    index("document_render_jobs_deal_idx").on(t.workspaceId, t.dealRecordId),
  ]
);

export type DocumentRenderJobRow = typeof documentRenderJobs.$inferSelect;
