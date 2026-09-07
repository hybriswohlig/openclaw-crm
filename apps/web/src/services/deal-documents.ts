// Deal PDF attachments (KV / AB / RE / AW), base64 in Postgres, 10 MB cap.
//
// The store-as-document path MUST call createDealDocument in-process. Posting
// the PDF back through POST /api/v1/deals/:id/documents is an inbound Vercel
// request and dies at the platform ~4.5 MB body limit (HTTP 413, empty
// upstream JSON) long before this 10 MB application cap.

import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { maybeNotifyPortalEvent } from "./customer-portal-notifications";

export const DEAL_DOCUMENT_TYPES = [
  "quotation",
  "order_confirmation",
  "invoice",
  "payment_confirmation",
  "worker_instructions",
] as const;

export type DealDocumentType = (typeof DEAL_DOCUMENT_TYPES)[number];

export const MAX_DEAL_DOCUMENT_SIZE = 10 * 1024 * 1024;

export interface DealDocumentMeta {
  id: string;
  documentType: DealDocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

export function isDealDocumentType(value: string): value is DealDocumentType {
  return (DEAL_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Pure: upload guard, with the HTTP status the route should answer. */
export function validateDealDocumentUpload(input: {
  fileName: string;
  fileSize: number;
  documentType: string;
}): { ok: true; documentType: DealDocumentType } | { ok: false; status: 400 | 413; error: string } {
  if (!input.fileName.trim()) {
    return { ok: false, status: 400, error: "file and documentType are required" };
  }
  if (!isDealDocumentType(input.documentType)) {
    return { ok: false, status: 400, error: "Invalid documentType" };
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, status: 400, error: "file and documentType are required" };
  }
  if (input.fileSize > MAX_DEAL_DOCUMENT_SIZE) {
    return { ok: false, status: 413, error: "File too large (max 10 MB)" };
  }
  return { ok: true, documentType: input.documentType };
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

  if (check.documentType === "order_confirmation" || check.documentType === "invoice") {
    void maybeNotifyPortalEvent(
      check.documentType === "order_confirmation" ? "ab_ready" : "invoice_ready",
      { workspaceId: input.workspaceId, dealRecordId: input.dealRecordId }
    ).catch(() => {});
  }

  return doc;
}
