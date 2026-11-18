import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { dealCalculationVersions } from "./deal-calculation-versions";
import { dealDocuments } from "./financial";
import type {
  KvAenderung,
  KvGrundlage,
  KvKonflikt,
  KvRenderer,
  KvStandQuelle,
  KvStandStatus,
} from "@/lib/kv-editor";

/**
 * KV-Editor (Migration 0071). Vertrag: `lib/kv-editor.ts`.
 *
 * Ein Stand je Speichern, nur angehängt, nie überschrieben. Jeder Stand trägt die
 * vollständige Änderungsliste und das Grundgerüst, aus dem gedruckt wird.
 * Entwürfe tragen ihr PDF selbst (`file_*`); gepushte Stände und Stände aus einem
 * neuen KV verweisen über `deal_document_id`. „Aktuell“ bleibt das neueste
 * `quotation`-Dokument des Deals. Jede Abfrage filtert nach `workspace_id`.
 */
export const kvStaende = pgTable(
  "kv_staende",
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
    /** „Stand 1, 2, …“ je Deal, vergeben unter der Sperre `kvEditorSperrSchluessel(deal)`. */
    nummer: integer("nummer").notNull(),
    vorgaengerId: text("vorgaenger_id").references((): AnyPgColumn => kvStaende.id, { onDelete: "set null" }),
    renderer: text("renderer").$type<KvRenderer>().notNull(),
    calculationVersionId: text("calculation_version_id").references(() => dealCalculationVersions.id, {
      onDelete: "set null",
    }),
    grundlage: jsonb("grundlage").$type<KvGrundlage>().notNull(),
    grundlageRekonstruiert: boolean("grundlage_rekonstruiert").notNull().default(false),
    aenderungen: jsonb("aenderungen").$type<KvAenderung[]>().notNull().default([]),
    offen: jsonb("offen").$type<KvKonflikt[]>().notNull().default([]),
    quelle: text("quelle").$type<KvStandQuelle>().notNull(),
    status: text("status").$type<KvStandStatus>().notNull().default("druckt"),
    fehler: text("fehler"),
    /** VPS-Job (`document_render_jobs.vps_job_id`), ohne FK wie im Job-Register. */
    renderJobId: text("render_job_id"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    /** base64 wie `deal_documents.file_content`; beim Pushen geleert. */
    fileContent: text("file_content"),
    dealDocumentId: text("deal_document_id").references(() => dealDocuments.id, { onDelete: "set null" }),
    erstelltVon: text("erstellt_von"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    gepushtVon: text("gepusht_von"),
    gepushtAm: timestamp("gepusht_am", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("kv_staende_deal_nummer_uq").on(t.dealRecordId, t.nummer),
    index("kv_staende_ws_deal_idx").on(t.workspaceId, t.dealRecordId, t.createdAt),
    uniqueIndex("kv_staende_dokument_uq").on(t.dealDocumentId).where(sql`${t.dealDocumentId} IS NOT NULL`),
    check("kv_staende_renderer_check", sql`${t.renderer} IN ('vps','crm')`),
    check("kv_staende_quelle_check", sql`${t.quelle} IN ('neu','ausgang','hand','ki','mitgewandert')`),
    check("kv_staende_status_check", sql`${t.status} IN ('druckt','fertig','fehler')`),
  ]
);

export type KvStandRow = typeof kvStaende.$inferSelect;
export type NeuerKvStandRow = typeof kvStaende.$inferInsert;
