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

import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import {
  shouldNotifyDealDocument,
  validateDealDocumentUpload,
  type DealDocumentType,
} from "@/lib/deal-document-upload";
import { maybeNotifyPortalEvent } from "./customer-portal-notifications";

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
}): Promise<DealDocumentMeta> {
  const check = validateDealDocumentUpload(input);
  if (!check.ok) throw new Error(check.error);

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

  return doc;
}
