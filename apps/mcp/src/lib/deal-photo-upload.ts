/**
 * Pre-check for crm_upload_deal_photo, before the JSON body is posted.
 *
 * Keep the limit and the error sentence identical to
 * oversizedJsonDealPhotoError / jsonDealPhotoTooLargeMessage in
 * apps/web/src/lib/deal-photo-upload.ts. This package cannot import that
 * module (the web file uses the app's path alias).
 *
 * 3 * 1024 * 1024 is the decoded ceiling: 3 MB decoded is ~4 MB of base64,
 * which stays under Vercel's ~4.5 MB request-body limit.
 */

export const MAX_JSON_DEAL_PHOTO_BYTES = 3 * 1024 * 1024;

export function jsonUploadDecodedBytes(contentBase64: string): number {
  const stripped = contentBase64.trim().replace(/^data:[^,]*,/i, "");
  const normalised = stripped.replace(/\s+/g, "");
  return base64ByteLength(normalised);
}

export function oversizedJsonDealPhotoError(decodedBytes: number): string | null {
  if (decodedBytes > MAX_JSON_DEAL_PHOTO_BYTES) {
    return (
      `Photo too large for JSON upload (max ${MAX_JSON_DEAL_PHOTO_BYTES} bytes decoded, 3 MB). ` +
      "Base64 of a larger photo exceeds Vercel's ~4.5 MB request limit and is not stored."
    );
  }
  return null;
}

function base64ByteLength(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64[len - 1] === "=") padding++;
  if (len > 1 && base64[len - 2] === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}
