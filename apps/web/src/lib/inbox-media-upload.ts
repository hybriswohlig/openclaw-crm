/** Vercel rejects a function request above 4.5 MB before our route runs. */
export const INBOX_DIRECT_UPLOAD_MAX_BYTES = 3_500_000;

/** Stay under the bridge JSON limit once the file is base64-encoded. */
export const INBOX_BLOB_MAX_BYTES = 20 * 1024 * 1024;

export function inboxMediaBlobPrefix(conversationId: string): string {
  return `inbox/conv/${conversationId}/`;
}

export function isInboxMediaBlobPath(pathname: string, conversationId: string): boolean {
  return pathname.startsWith(inboxMediaBlobPrefix(conversationId));
}

export function isVercelBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
