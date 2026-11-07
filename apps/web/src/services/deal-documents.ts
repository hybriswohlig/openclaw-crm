// Deal PDF attachments (KV / AB / RE / AW), base64 in Postgres, 10 MB cap.
//
// The store-as-document path MUST call createDealDocument in-process. Posting
// the PDF back through POST /api/v1/deals/:id/documents is an inbound Vercel
// request and dies at the platform ~4.5 MB body limit (HTTP 413, empty
// upstream JSON) long before this 10 MB application cap.
//
// crm_upload_deal_document is the exception that does post to that route:
// the MCP client can only send JSON. The size rules for that body live in
// lib/deal-document-upload.ts (3 MB decoded, under the platform limit).

import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { tasks, taskRecords } from "@/db/schema/tasks";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { dealDocuments } from "@/db/schema/financial";
import { quotations } from "@/db/schema/quotations";
import {
  shouldNotifyDealDocument,
  validateDealDocumentUpload,
  type DealDocumentType,
} from "@/lib/deal-document-upload";
import { maybeNotifyPortalEvent } from "./customer-portal-notifications";
import { aktualisiereWartet } from "./wartet";

export {
  DEAL_DOCUMENT_TYPES,
  MAX_DEAL_DOCUMENT_SIZE,
  isDealDocumentType,
  jsonDealDocumentTooLargeMessage,
  jsonUploadDecodedBytes,
  normalisedDealDocumentBase64,
  oversizedJsonDealDocumentError,
  prepareJsonDealDocument,
  shouldNotifyDealDocument,
  validateDealDocumentUpload,
  type DealDocumentType,
  type PreparedJsonDealDocument,
} from "@/lib/deal-document-upload";

export interface DealDocumentMeta {
  id: string;
  documentType: DealDocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

/**
 * Filename prefixes written by the crm-tools render skill.
 * KV / MUSTER-KV → quotation (Kostenvoranschlag).
 */
export function deduceDocumentType(filename: string): DealDocumentType | null {
  if (filename.startsWith("KV-") || filename.startsWith("MUSTER-KV-")) return "quotation";
  if (filename.startsWith("AB-")) return "order_confirmation";
  if (filename.startsWith("RE-")) return "invoice";
  if (filename.startsWith("AW-")) return "worker_instructions";
  return null;
}

export function parseFilenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const match = /filename\*?=(?:UTF-8'')?\"?([^;\"\n]+)\"?/i.exec(cd);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const META_COLUMNS = {
  id: dealDocuments.id,
  documentType: dealDocuments.documentType,
  fileName: dealDocuments.fileName,
  fileSize: dealDocuments.fileSize,
  mimeType: dealDocuments.mimeType,
  uploadedAt: dealDocuments.uploadedAt,
};

/**
 * Gesperrte Kalkulationsversion, auf die die Quotation des Deals zeigt
 * (`quotations.calculation_version_id`); null ohne Quotation oder ohne Version.
 */
export async function angebotsVersionId(dealRecordId: string, ex: DbExecutor = db): Promise<string | null> {
  const [row] = await ex
    .select({ calculationVersionId: quotations.calculationVersionId })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  return row?.calculationVersionId ?? null;
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Wie `dealImWorkspace`, aber über `ex` (unter einer Sperre keine zweite Verbindung). */
async function dealGehoertZumWorkspace(ex: DbExecutor, workspaceId: string, dealRecordId: string): Promise<boolean> {
  if (ex === db) return dealImWorkspace(workspaceId, dealRecordId);
  const [row] = await ex
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, dealRecordId),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "deals"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  return !!row;
}

export interface DealDocumentInput {
  workspaceId: string;
  dealRecordId: string;
  documentType: DealDocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileContent: string;
  /**
   * false skips the portal WhatsApp/email for order_confirmation and invoice.
   * Omit it to keep the staff-upload and render-job behaviour.
   */
  notifyCustomer?: boolean;
  /**
   * Kalkulationsversion, aus der dieser KV gerendert wurde: nur der Renderer kennt sie
   * (Quotation zum Zeitpunkt des Renderns). Fehlt sie, bleibt das Dokument ohne Version,
   * auch beim Hochladen; hier wird nie nachgeschlagen, denn bis zum Speichern kann eine
   * andere Version gesperrt worden sein. Andere Typen: immer null.
   */
  calculationVersionId?: string | null;
}

/**
 * Legt das Dokument an und stößt die Nachläufe an (Portal-Nachricht, Deal-Stufe,
 * Wartet-Signal).
 *
 * Mit `ex` (Transaktion): nur prüfen und einfügen, alles über `ex`. Die Nachläufe
 * laufen dann NICHT; der Aufrufer ruft `dealDokumentNachlauf` nach dem Commit,
 * sonst ginge eine Nachricht zu einem Dokument raus, das ein Rollback verwirft.
 */
export async function createDealDocument(input: DealDocumentInput, ex?: DbExecutor): Promise<DealDocumentMeta> {
  const doc = await dealDokumentEinfuegen(input, ex ?? db);
  if (!ex) await dealDokumentNachlauf(input, doc.documentType);
  return doc;
}

async function dealDokumentEinfuegen(input: DealDocumentInput, ex: DbExecutor): Promise<DealDocumentMeta> {
  const check = validateDealDocumentUpload(input);
  if (!check.ok) throw new Error(check.error);
  if (!(await dealGehoertZumWorkspace(ex, input.workspaceId, input.dealRecordId))) {
    throw new Error("Deal nicht gefunden.");
  }
  const calculationVersionId = check.documentType === "quotation" ? input.calculationVersionId ?? null : null;

  const [doc] = await ex
    .insert(dealDocuments)
    .values({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      documentType: check.documentType,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType || "application/octet-stream",
      fileContent: input.fileContent,
      calculationVersionId,
    })
    .returning(META_COLUMNS);

  // Die Tabelle kennt auch signed_contract; dieser Weg schreibt nur geprüfte Upload-Typen.
  return { ...doc, documentType: check.documentType };
}

/** Nachläufe eines neuen Dokuments; nach dem Commit aufrufen. */
export async function dealDokumentNachlauf(
  input: Pick<DealDocumentInput, "workspaceId" | "dealRecordId" | "notifyCustomer">,
  documentType: DealDocumentType
): Promise<void> {
  const check = { documentType };
  if (shouldNotifyDealDocument(check.documentType, input.notifyCustomer)) {
    void maybeNotifyPortalEvent(
      check.documentType === "order_confirmation" ? "ab_ready" : "invoice_ready",
      { workspaceId: input.workspaceId, dealRecordId: input.dealRecordId }
    ).catch(() => {});
  }

  if (check.documentType === "quotation") {
    void import("./deal-attribution")
      .then((mod) =>
        mod.advanceDealToQuotedIfEarlier({
          workspaceId: input.workspaceId,
          dealRecordId: input.dealRecordId,
          reason: "Kostenvoranschlag gespeichert",
        })
      )
      .catch((err) => {
        console.error("[deal-documents] quoted advance failed:", err);
      });
  }

  // Plan 9, Entscheidung 16: eine abgelegte AB erledigt die offene Aufgabe „AB erstellen: Auftrag N“.
  if (check.documentType === "order_confirmation") {
    try {
      await abAufgabeErledigen(input.workspaceId, input.dealRecordId);
    } catch (err) {
      console.error("[deal-documents] AB-Aufgabe erledigen fehlgeschlagen:", err);
    }
  }

  // KV, AB und Rechnung verschieben das Wartet-Signal; Fehler brechen das Speichern nicht.
  try {
    await aktualisiereWartet(input.workspaceId, input.dealRecordId);
  } catch (err) {
    console.error("[wartet] nach Dokument fehlgeschlagen:", err);
  }
}

/** Nur die Aufgabe „AB erstellen: Auftrag …“ dieses Deals, nur solange offen. */
export async function abAufgabeErledigen(workspaceId: string, dealRecordId: string): Promise<number> {
  const offen = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(taskRecords, eq(taskRecords.taskId, tasks.id))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(taskRecords.recordId, dealRecordId),
        eq(tasks.isCompleted, false),
        like(tasks.content, "AB erstellen: Auftrag %")
      )
    );
  if (offen.length === 0) return 0;
  const jetzt = new Date();
  const rows = await db
    .update(tasks)
    .set({ isCompleted: true, completedAt: jetzt, kanbanStatus: "erledigt" })
    .where(and(inArray(tasks.id, offen.map((t) => t.id)), eq(tasks.isCompleted, false)))
    .returning({ id: tasks.id });
  return rows.length;
}
