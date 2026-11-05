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

import { eq } from "drizzle-orm";
import { db } from "@/db";
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
export async function angebotsVersionId(dealRecordId: string): Promise<string | null> {
  const [row] = await db
    .select({ calculationVersionId: quotations.calculationVersionId })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  return row?.calculationVersionId ?? null;
}

/**
 * Version, mit der ein neues Dokument verknüpft wird: nur ein KV (`quotation`),
 * explizite Angabe (auch null) gilt, sonst die Version der Quotation. Deckt den
 * CRM-Renderer und den VPS-Weg `store-as-document`. Scheitert die Abfrage, wird
 * das Dokument ohne Version gespeichert (das Speichern geht vor).
 */
async function versionFuerDokument(input: {
  dealRecordId: string;
  documentType: DealDocumentType;
  calculationVersionId?: string | null;
}): Promise<string | null> {
  if (input.documentType !== "quotation") return null;
  if (input.calculationVersionId !== undefined) return input.calculationVersionId;
  try {
    return await angebotsVersionId(input.dealRecordId);
  } catch (err) {
    console.error("[deal-documents] Kalkulationsversion nicht gelesen:", err);
    return null;
  }
}

export async function createDealDocument(input: {
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
   * Kalkulationsversion des KV. Fehlt sie, gilt bei `quotation` die Version der
   * Quotation des Deals; null bleibt null. Andere Typen: immer null.
   */
  calculationVersionId?: string | null;
}): Promise<DealDocumentMeta> {
  const check = validateDealDocumentUpload(input);
  if (!check.ok) throw new Error(check.error);
  const calculationVersionId = await versionFuerDokument({ ...input, documentType: check.documentType });

  const [doc] = await db
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

  // KV, AB und Rechnung verschieben das Wartet-Signal; Fehler brechen das Speichern nicht.
  try {
    await aktualisiereWartet(input.workspaceId, input.dealRecordId);
  } catch (err) {
    console.error("[wartet] nach Dokument fehlgeschlagen:", err);
  }

  // Die Tabelle kennt auch signed_contract; dieser Weg schreibt nur geprüfte Upload-Typen.
  return { ...doc, documentType: check.documentType };
}
