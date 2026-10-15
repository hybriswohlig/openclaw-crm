import {
  INBOX_MEDIA_INVALID_BLOB_TOKEN_MESSAGE,
  INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE,
} from "./inbox-media-upload";

export type InboxMediaUploadCheck =
  | "missing BLOB_READ_WRITE_TOKEN"
  | "auth"
  | "path"
  | "conversation"
  | "unknown";

export interface InboxMediaUploadFailure {
  check: InboxMediaUploadCheck;
  /** Safe to log. The read-write token value is never included. */
  message: string;
  clientMessage: string;
}

const AUTH_FAILURE = "Nicht angemeldet.";
const PATH_FAILURE = "Ungültiger Upload-Pfad.";
const CONVERSATION_FAILURE = "Unterhaltung nicht gefunden.";

/** Drop blob credentials before a message is logged or returned to the browser. */
export function redactInboxMediaSecrets(message: string): string {
  let out = message;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) out = out.split(token).join("[redacted]");
  return out.replace(/vercel_blob_[A-Za-z0-9_=-]+/g, "[redacted]");
}

function mentionsBlobToken(message: string): boolean {
  return /BLOB_READ_WRITE_TOKEN|no read-write token|no blob credentials|failed to\s+retrieve the client token|invalid `token` parameter/i.test(
    message,
  );
}

/**
 * Name which upload check failed. The composer only sees `clientMessage`;
 * `message` is the underlying error with secrets removed.
 */
export function describeInboxMediaUploadError(err: unknown): InboxMediaUploadFailure {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Upload fehlgeschlagen";
  const message = redactInboxMediaSecrets(raw);

  if (message === AUTH_FAILURE) {
    return { check: "auth", message, clientMessage: AUTH_FAILURE };
  }
  if (message === PATH_FAILURE) {
    return { check: "path", message, clientMessage: PATH_FAILURE };
  }
  if (message === CONVERSATION_FAILURE) {
    return { check: "conversation", message, clientMessage: CONVERSATION_FAILURE };
  }

  const envMissing = !process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (envMissing || mentionsBlobToken(raw)) {
    return {
      check: "missing BLOB_READ_WRITE_TOKEN",
      message,
      clientMessage: envMissing
        ? INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE
        : INBOX_MEDIA_INVALID_BLOB_TOKEN_MESSAGE,
    };
  }

  return {
    check: "unknown",
    message,
    clientMessage: message || "Upload fehlgeschlagen",
  };
}
