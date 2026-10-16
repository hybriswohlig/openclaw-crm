/**
 * Pre-check for inline WhatsApp document bytes, before the JSON body is posted.
 *
 * Keep the limit and the error sentence identical to
 * inlineWhatsAppDocumentTooLargeMessage in
 * apps/web/src/services/whatsapp-document.ts. This package cannot import that
 * module.
 *
 * 3 * 1024 * 1024 decoded stays under Vercel's ~4.5 MB request-body limit.
 * Larger PDFs must be stored on the deal and referenced by dealDocumentId.
 */

export const MAX_INLINE_WHATSAPP_DOCUMENT_BYTES = 3 * 1024 * 1024;

export function inlineWhatsAppDocumentTooLargeMessage(): string {
  return (
    `Attachment too large for an inline JSON upload (max ${MAX_INLINE_WHATSAPP_DOCUMENT_BYTES} bytes decoded, 3 MB). ` +
    "Base64 of a larger file exceeds Vercel's ~4.5 MB request limit. " +
    "Store the PDF on the deal and pass dealDocumentId so the server reads it from storage."
  );
}

export function inlineDocumentDecodedBytes(dataBase64: string): number {
  const stripped = dataBase64.trim().replace(/^data:[^,]*,/i, "");
  const normalised = stripped.replace(/\s+/g, "");
  return base64ByteLength(normalised);
}

export function rejectOversizedInlineDocuments(attachments: unknown): void {
  if (!Array.isArray(attachments)) return;
  for (const item of attachments) {
    if (!item || typeof item !== "object") continue;
    const data = (item as { dataBase64?: unknown }).dataBase64;
    if (typeof data !== "string" || !data.trim()) continue;
    if (inlineDocumentDecodedBytes(data) > MAX_INLINE_WHATSAPP_DOCUMENT_BYTES) {
      throw new Error(inlineWhatsAppDocumentTooLargeMessage());
    }
  }
}

function base64ByteLength(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64[len - 1] === "=") padding++;
  if (base64[len - 2] === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}
