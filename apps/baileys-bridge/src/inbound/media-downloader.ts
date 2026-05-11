/**
 * Wraps Baileys' `downloadMediaMessage` with the bits the inbound handler
 * needs: a base64 payload, a sensible filename, and a stable external id
 * for dedup.
 */
import { downloadMediaMessage } from "baileys";
import type { proto, WAMessage, WASocket } from "baileys";
import type { Logger } from "../lib/logger.js";
import { mediaKindOf, captionOf, filenameOf, mimeOf } from "./envelope.js";

export interface DownloadedAttachment {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContentBase64: string;
  externalMediaId: string | null;
}

const MAX_BYTES = 25 * 1024 * 1024; // match WABA's 25MB inbound cap

export async function tryDownloadAttachment(params: {
  msg: WAMessage;
  sock: WASocket;
  log: Logger;
}): Promise<DownloadedAttachment | null> {
  const { msg, sock, log } = params;
  const m: proto.IMessage | null | undefined = msg.message;
  if (!m) return null;
  const kind = mediaKindOf(m);
  if (!kind) return null;

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      {
        logger: log as never,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (buffer.byteLength > MAX_BYTES) {
      log.warn(
        { kind, byteLength: buffer.byteLength, cap: MAX_BYTES },
        "[media-downloader] media exceeds size cap, skipping",
      );
      return null;
    }

    const mimeType = mimeOf(m, kind);
    const fileName = filenameOf(m, kind, mimeType);
    return {
      fileName,
      mimeType,
      fileSize: buffer.byteLength,
      fileContentBase64: buffer.toString("base64"),
      externalMediaId: extractMediaId(m, kind),
    };
  } catch (err) {
    log.warn(
      { err, kind },
      "[media-downloader] download failed, dropping attachment",
    );
    return null;
  }
}

export { mediaKindOf, captionOf };

function extractMediaId(
  m: proto.IMessage,
  kind: ReturnType<typeof mediaKindOf>,
): string | null {
  if (!kind) return null;
  // WhatsApp media envelopes carry directPath or mediaKey hashes; the
  // directPath uniquely identifies the upload at the CDN level.
  const env = (m as Record<string, unknown>)[`${kind}Message`] as
    | { directPath?: string; mediaKey?: Uint8Array | Buffer }
    | undefined;
  if (env?.directPath) return env.directPath;
  if (env?.mediaKey) {
    return Buffer.from(env.mediaKey).toString("base64").slice(0, 32);
  }
  return null;
}
