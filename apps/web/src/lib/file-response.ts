/**
 * Headers for responses that stream a stored file (inbox attachments, deal and
 * project documents, receipts, portal photos).
 *
 * The stored MIME type comes from whoever sent or uploaded the file, so it is
 * not trusted: an `image/svg+xml` or `text/html` file served inline from the
 * CRM origin runs script with the viewer's session. Only types that cannot run
 * script are served inline; everything else is a plain download, and
 * `nosniff` stops the browser from guessing its way back to HTML.
 */

const INLINE_SAFE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
]);

const MEDIA_RE = /^(audio|video)\/[a-z0-9.+-]+$/;

function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0].trim().toLowerCase();
}

/** RFC 5987 value for `filename*`; encodeURIComponent leaves '()* unescaped. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function fileResponseHeaders(opts: {
  mimeType: string | null | undefined;
  fileName: string;
  download?: boolean;
}): Record<string, string> {
  const mime = normalizeMime(opts.mimeType);
  const safe = INLINE_SAFE.has(mime) || MEDIA_RE.test(mime);
  const kind = safe && !opts.download ? "inline" : "attachment";

  const name = opts.fileName.trim() || "datei";
  // ASCII fallback for old clients; header values must stay Latin-1 or
  // Node throws "Cannot convert argument to a ByteString".
  const asciiName = name.replace(/["\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");

  return {
    "Content-Type": safe ? mime : "application/octet-stream",
    "Content-Disposition": `${kind}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(name)}`,
    "X-Content-Type-Options": "nosniff",
  };
}
