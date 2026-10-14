// Pure rules for deal-document uploads.
//
// crm_upload_deal_document posts JSON because the MCP client cannot build
// multipart. Base64 expands by 4/3, so a decoded file at MAX_JSON_INLINE_BYTES
// (3 MB → ~4 MB of base64, plus a small envelope) stays under Vercel's
// ~4.5 MB request-body limit. The 10 MB application cap still applies; only
// the in-process render-job store can reach it.

import {
  MAX_JSON_INLINE_BYTES,
  base64ByteLength,
  normaliseBase64,
} from "@/lib/attachment-content";

export const DEAL_DOCUMENT_TYPES = [
  "quotation",
  "order_confirmation",
  "invoice",
  "payment_confirmation",
  "worker_instructions",
] as const;

export type DealDocumentType = (typeof DEAL_DOCUMENT_TYPES)[number];

export const MAX_DEAL_DOCUMENT_SIZE = 10 * 1024 * 1024;

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
 * Portal notifier for a stored deal document.
 *
 * order_confirmation and invoice call maybeNotifyPortalEvent (WhatsApp into
 * an existing thread, transactional email as the fallback) when the workspace
 * flag portal_notifications_enabled is on. Every other type is silent.
 * `notifyCustomer: false` suppresses that call; omitting it keeps the
 * historical behaviour of the staff upload and crm_store_document_job.
 */
export function shouldNotifyDealDocument(
  documentType: DealDocumentType,
  notifyCustomer: boolean | undefined
): boolean {
  if (notifyCustomer === false) return false;
  return documentType === "order_confirmation" || documentType === "invoice";
}

const DATA_URL_PREFIX = /^data:[^,]*,/i;

/** Strip a data-URL prefix and whitespace. Does not validate the alphabet. */
export function normalisedDealDocumentBase64(contentBase64: string): string {
  return normaliseBase64(contentBase64.trim().replace(DATA_URL_PREFIX, ""));
}

/** Decoded size of a JSON upload, without allocating the file. */
export function jsonUploadDecodedBytes(contentBase64: string): number {
  return base64ByteLength(normalisedDealDocumentBase64(contentBase64));
}

export function jsonDealDocumentTooLargeMessage(): string {
  return (
    `File too large for JSON upload (max ${MAX_JSON_INLINE_BYTES} bytes decoded, 3 MB). ` +
    "Base64 of a larger file exceeds Vercel's ~4.5 MB request limit and is not stored."
  );
}

/**
 * Size gate shared by the MCP pre-check and the JSON route.
 * The 10 MB application cap is reported first; the tighter JSON cap is what
 * keeps the request under Vercel's ~4.5 MB body limit.
 */
export function oversizedJsonDealDocumentError(decodedBytes: number): string | null {
  if (decodedBytes > MAX_DEAL_DOCUMENT_SIZE) {
    return "File too large (max 10 MB)";
  }
  if (decodedBytes > MAX_JSON_INLINE_BYTES) {
    return jsonDealDocumentTooLargeMessage();
  }
  return null;
}

export type PreparedJsonDealDocument =
  | {
      ok: true;
      fileName: string;
      documentType: DealDocumentType;
      mimeType: string;
      fileSize: number;
      fileContent: string;
    }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Turn a JSON/base64 upload body into the arguments createDealDocument expects.
 * Does not notify; the route decides notifyCustomer.
 */
export function prepareJsonDealDocument(input: {
  fileName: unknown;
  documentType: unknown;
  mimeType: unknown;
  contentBase64: unknown;
}): PreparedJsonDealDocument {
  if (typeof input.fileName !== "string" || !input.fileName.trim()) {
    return {
      ok: false,
      status: 400,
      error: "fileName, documentType and contentBase64 are required",
    };
  }
  if (typeof input.documentType !== "string" || !input.documentType.trim()) {
    return {
      ok: false,
      status: 400,
      error: "fileName, documentType and contentBase64 are required",
    };
  }
  if (typeof input.contentBase64 !== "string" || !input.contentBase64.trim()) {
    return {
      ok: false,
      status: 400,
      error: "fileName, documentType and contentBase64 are required",
    };
  }

  const normalised = normalisedDealDocumentBase64(input.contentBase64);
  const fileContent = canonicalBase64(normalised);
  if (!fileContent) {
    return { ok: false, status: 400, error: "contentBase64 is not valid base64" };
  }

  const bytes = Buffer.from(fileContent, "base64");
  const fileName = input.fileName.trim();
  const documentType = input.documentType.trim();
  const check = validateDealDocumentUpload({
    fileName,
    fileSize: bytes.length,
    documentType,
  });
  if (!check.ok) return check;

  const tooBig = oversizedJsonDealDocumentError(bytes.length);
  if (tooBig) return { ok: false, status: 413, error: tooBig };

  const mimeType =
    typeof input.mimeType === "string" && input.mimeType.trim()
      ? input.mimeType.trim()
      : "application/pdf";

  return {
    ok: true,
    fileName,
    documentType: check.documentType,
    mimeType,
    fileSize: bytes.length,
    fileContent,
  };
}

function canonicalBase64(normalised: string): string | null {
  if (!normalised) return null;
  const mod = normalised.length % 4;
  // A legal base64 length is never 1 (mod 4).
  if (mod === 1) return null;
  const padded = mod === 0 ? normalised : normalised + "=".repeat(4 - mod);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) return null;
  const bytes = Buffer.from(padded, "base64");
  if (bytes.toString("base64") !== padded) return null;
  return padded;
}
