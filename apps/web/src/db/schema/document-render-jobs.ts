import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { records } from "./records";
import { dealCalculationVersions } from "./deal-calculation-versions";
import { dealDocuments } from "./financial";
import { dealInvoices } from "./deal-invoices";
import { kvStaende } from "./kv-editor";
import type { KvStandZiel } from "@/lib/kv-editor";

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
    /**
     * KV-Editor (Migration 0071): Stand, zu dem dieser Job druckt, und Ziel. Ein Stand
     * nur mit Ziel; Ziel ohne Stand heißt „Stand gelöscht, nichts ablegen“ (SET NULL).
     * `entwurf`: PDF in den Stand, nie in `deal_documents`; `aktuell`: normaler KV aus
     * der Kalkulation, der danach seinen Stand verknüpft.
     */
    kvStandId: text("kv_stand_id").references((): AnyPgColumn => kvStaende.id, { onDelete: "set null" }),
    kvStandZiel: text("kv_stand_ziel").$type<KvStandZiel>(),
  },
  (t) => [
    index("document_render_jobs_status_idx").on(t.status, t.createdAt),
    index("document_render_jobs_deal_idx").on(t.workspaceId, t.dealRecordId),
    check(
      "document_render_jobs_kv_stand_ziel_chk",
      sql`${t.kvStandZiel} IS NULL OR ${t.kvStandZiel} IN ('entwurf','aktuell')`
    ),
    check("document_render_jobs_kv_stand_paar_chk", sql`${t.kvStandId} IS NULL OR ${t.kvStandZiel} IS NOT NULL`),
  ]
);

export type DocumentRenderJobRow = typeof documentRenderJobs.$inferSelect;
