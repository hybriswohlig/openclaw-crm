// Helpers for the PRIVATE Vercel Blob store backing the employee portal.
// The store is created in the Vercel project (BLOB_READ_WRITE_TOKEN env). All
// employee media is private: readable only through the authed deliver route.

export const JOB_MEDIA_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
];

/** 200 MB ceiling — generous for short job videos, bounded for cost. */
export const JOB_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

/** Deterministic, scoped pathname; addRandomSuffix is added by the SDK. */
export function jobMediaPathname(opts: {
  workspaceId: string;
  dealRecordId: string | null;
  category: string;
  fileName: string;
}): string {
  const safeName = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-64) || "upload";
  const deal = opts.dealRecordId ?? "no-deal";
  return `ws/${opts.workspaceId}/deals/${deal}/${opts.category}/${safeName}`;
}
