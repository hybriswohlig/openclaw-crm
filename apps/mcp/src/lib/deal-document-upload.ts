/**
 * Pre-check for crm_upload_deal_document, before the JSON body is posted.
 *
 * Keep the limits and the error sentences identical to
 * oversizedJsonDealDocumentError / jsonDealDocumentTooLargeMessage in
 * apps/web/src/lib/deal-document-upload.ts. This package cannot import that
 * module (the web file uses the app's path alias).
 *
 * 3 * 1024 * 1024 is MAX_JSON_INLINE_BYTES: 3 MB decoded is ~4 MB of base64,
 * which stays under Vercel's ~4.5 MB request-body limit. The 10 MB figure is
 * the application cap enforced by validateDealDocumentUpload.
 */

export const MAX_DEAL_DOCUMENT_SIZE = 10 * 1024 * 1024;
export const MAX_JSON_DEAL_DOCUMENT_BYTES = 3 * 1024 * 1024;

export function jsonUploadDecodedBytes(contentBase64: string): number {
  const stripped = contentBase64.trim().replace(/^data:[^,]*,/i, "");
  const normalised = stripped.replace(/\s+/g, "");
  return base64ByteLength(normalised);
}

export function oversizedJsonDealDocumentError(decodedBytes: number): string | null {
  if (decodedBytes > MAX_DEAL_DOCUMENT_SIZE) {
    return "File too large (max 10 MB)";
  }
  if (decodedBytes > MAX_JSON_DEAL_DOCUMENT_BYTES) {
    return (
      `File too large for JSON upload (max ${MAX_JSON_DEAL_DOCUMENT_BYTES} bytes decoded, 3 MB). ` +
      "Base64 of a larger file exceeds Vercel's ~4.5 MB request limit and is not stored."
    );
  }
  return null;
}

function base64ByteLength(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64[len - 1] === "=") padding++;
  if (base64[len - 2] === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}
