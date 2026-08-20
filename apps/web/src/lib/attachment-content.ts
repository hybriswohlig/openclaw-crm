/**
 * Shared rules for handing inbox attachment bytes to a JSON consumer.
 *
 * `inbox_message_attachments.file_content` is already base64, so nothing here
 * re-encodes anything — this module only decides which mime types a vision
 * model can actually render and how big a payload we are willing to inline.
 */

/**
 * Mime types an MCP client can render as an image content block.
 *
 * Deliberately narrow: these four are what the Anthropic / OpenAI vision APIs
 * accept. Anything else (PDF, HEIC, audio) still gets its base64, just not an
 * image block, because a client that tries to render it errors the whole call.
 */
export const RENDERABLE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export function isRenderableImage(mimeType: string): boolean {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  // image/jpg is not a real mime type but WhatsApp and some mail clients send it.
  const normalised = base === "image/jpg" ? "image/jpeg" : base;
  return (RENDERABLE_IMAGE_MIME_TYPES as readonly string[]).includes(normalised);
}

/** Canonical mime for an image content block ("image/jpg" → "image/jpeg"). */
export function normaliseImageMime(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return base === "image/jpg" ? "image/jpeg" : base;
}

/**
 * Ceiling for bytes carried inside one buffered JSON response.
 *
 * This is a transport limit, not a taste one. `NextResponse.json` buffers the
 * whole body and base64 inflates it by 4/3, so a serverless platform's
 * non-streaming response cap (~4.5 MB on Vercel) is reached at roughly 75% of
 * the file size the raw `/content` stream handles fine. 3 MB decoded ≈ 4 MB of
 * base64 stays under that with room for the JSON envelope.
 *
 * Sized against real traffic: of 719 images in production the largest is a
 * 2.4 MB JPEG and the median customer photo is ~250 KB, so no photo comes
 * near this. What does not fit is the non-photo tail — a 9.1 MB video, a
 * 4.9 MB PDF — and those are refused loudly (413 with a pointer to
 * `/content`) rather than being handed to a platform that answers with HTML.
 *
 * Do not raise this above what the deployment can actually buffer. The way to
 * serve a bigger file is the raw `/content` stream, not a bigger JSON body.
 */
export const MAX_JSON_INLINE_BYTES = 3 * 1024 * 1024;

/** Default budget for the bytes one MCP tool result may carry, in any form. */
export const MAX_MCP_INLINE_BYTES = MAX_JSON_INLINE_BYTES;

/**
 * Hard ceiling a caller-supplied `maxBytes` cannot exceed.
 *
 * Equal to the JSON ceiling on purpose: raising `maxBytes` past what the REST
 * route can return would only trade an honest "too large" for a platform error.
 */
export const MAX_MCP_INLINE_BYTES_LIMIT = MAX_JSON_INLINE_BYTES;

/**
 * Strip whitespace from stored base64.
 *
 * Everything written by this codebase comes from `Buffer.toString("base64")`,
 * which never wraps — but the Baileys bridge posts `fileContentBase64` from a
 * separate deployment and it is stored verbatim. A wrapped or padded-with-
 * newlines string would both mis-size `base64ByteLength` and be rejected by the
 * MCP SDK's `z.string().base64()`, so normalise once at the boundary.
 */
export function normaliseBase64(base64: string): string {
  return /\s/.test(base64) ? base64.replace(/\s+/g, "") : base64;
}

/** Decoded byte length of a base64 string, without allocating a Buffer. */
export function base64ByteLength(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64[len - 1] === "=") padding++;
  if (base64[len - 2] === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}

export function resolveMaxBytes(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return MAX_MCP_INLINE_BYTES;
  }
  return Math.min(Math.floor(requested), MAX_MCP_INLINE_BYTES_LIMIT);
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContent: string;
  transcript?: string | null;
  createdAt: Date | string;
  conversationId: string;
  messageId: string;
  dealRecordId?: string | null;
}

export interface AttachmentPayload {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Base64 exactly as stored — decode this to get the original file. */
  contentBase64: string;
  isImage: boolean;
  conversationId: string;
  messageId: string;
  dealRecordId: string | null;
  createdAt: string;
  /** Present only for voice notes the transcribe cron has processed. */
  transcript?: string;
}

/** Shape one DB row into the JSON body the REST route returns. */
export function toAttachmentPayload(row: AttachmentRow): AttachmentPayload {
  const payload: AttachmentPayload = {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    contentBase64: normaliseBase64(row.fileContent),
    isImage: isRenderableImage(row.mimeType),
    conversationId: row.conversationId,
    messageId: row.messageId,
    dealRecordId: row.dealRecordId ?? null,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
  if (row.transcript) payload.transcript = row.transcript;
  return payload;
}
