import { put } from "@vercel/blob/client";

/** Vercel rejects a function request above 4.5 MB before our route runs. */
export const INBOX_DIRECT_UPLOAD_MAX_BYTES = 3_500_000;

/**
 * Largest file the composer stages in Blob. 20 MB raw is ~26.7 MB of base64,
 * which fits in {@link INBOX_BRIDGE_BODY_LIMIT_BYTES}.
 */
export const INBOX_BLOB_MAX_BYTES = 20 * 1024 * 1024;

/**
 * JSON body cap on the bridge `POST /accounts/:id/send`.
 * Must match `BRIDGE_BODY_LIMIT_BYTES` in `apps/baileys-bridge`.
 * Fastify's default is 1 MiB (~750 KB of raw file once base64-encoded).
 * 30 MiB covers a 20 MB file plus the JSON envelope, and stays under the
 * host nginx `client_max_body_size 50m`.
 */
export const INBOX_BRIDGE_BODY_LIMIT_BYTES = 30 * 1024 * 1024;

export const INBOX_MEDIA_UPLOAD_URL = "/api/v1/inbox/media-upload";

/** Shown in the composer when the blob store token is not configured. */
export const INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE =
  "Datei-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt auf dem Server).";

export const INBOX_MEDIA_INVALID_BLOB_TOKEN_MESSAGE =
  "Datei-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN ist ungültig).";

export function inboxMediaUploadFailureMessage(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error.trim()
  ) {
    return body.error;
  }
  return "Upload-Token konnte nicht erstellt werden.";
}

/**
 * Byte length of the bridge send body.
 * `emptyMediaEnvelopeBytes` is `JSON.stringify` of the same object with
 * `mediaBase64: ""`. Base64 is ASCII and needs no JSON escaping, so the
 * encoded file is that many extra bytes between the quotes.
 */
export function inboxBridgeJsonBytes(fileBytes: number, emptyMediaEnvelopeBytes: number): number {
  const base64Bytes = fileBytes <= 0 ? 0 : 4 * Math.ceil(fileBytes / 3);
  return emptyMediaEnvelopeBytes + base64Bytes;
}

export function inboxMediaFitsBridge(fileBytes: number, emptyMediaEnvelopeBytes: number): boolean {
  return inboxBridgeJsonBytes(fileBytes, emptyMediaEnvelopeBytes) <= INBOX_BRIDGE_BODY_LIMIT_BYTES;
}

export function inboxMediaBlobPrefix(conversationId: string): string {
  return `inbox/conv/${conversationId}/`;
}

export function isInboxMediaBlobPath(pathname: string, conversationId: string): boolean {
  return pathname.startsWith(inboxMediaBlobPrefix(conversationId));
}

/**
 * Browser upload for files that must not go through a Vercel function body.
 * Reads the token route's JSON error. `@vercel/blob` `upload()` throws
 * "Failed to retrieve the client token" and drops that body, so the composer
 * would hide a missing `BLOB_READ_WRITE_TOKEN`.
 */
export async function uploadInboxMediaBlob(opts: {
  pathname: string;
  file: Blob;
  contentType: string;
  multipart: boolean;
}): Promise<{ url: string }> {
  const res = await fetch(INBOX_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname: opts.pathname,
        clientPayload: null,
        multipart: opts.multipart,
      },
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(inboxMediaUploadFailureMessage(body));
  }
  const clientToken =
    body &&
    typeof body === "object" &&
    "clientToken" in body &&
    typeof body.clientToken === "string"
      ? body.clientToken
      : "";
  if (!clientToken) {
    throw new Error("Upload-Token konnte nicht erstellt werden.");
  }
  return put(opts.pathname, opts.file, {
    access: "private",
    token: clientToken,
    contentType: opts.contentType,
    multipart: opts.multipart,
  });
}

export function isVercelBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
