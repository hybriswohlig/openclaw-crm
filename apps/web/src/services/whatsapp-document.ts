/**
 * Pure rules for sending a WhatsApp document from the CRM.
 *
 * The in-house bridge already accepts this on `POST /accounts/:id/send`
 * (see apps/baileys-bridge). The CRM never logs or returns the bridge secret.
 *
 *   {
 *     "kind": "document",
 *     "peerWaId": "<digits or full JID>",
 *     "mediaBase64": "<standard base64, no data-URL prefix>",
 *     "mimeType": "application/pdf",
 *     "fileName": "angebot.pdf",
 *     "caption": "<optional; omit when the text is a separate message>"
 *   }
 *
 * A separate text uses the existing `{ kind: "text", peerWaId, text }` body.
 * Inline bytes are capped at 3 MB decoded so the JSON request stays under
 * Vercel's ~4.5 MB function body limit. Larger PDFs (the real ones are about
 * 2.9 MB and fit; bigger ones do not) must be referenced by dealDocumentId
 * and are read from storage on the server.
 */
import { createHash } from "crypto";
import { MAX_JSON_INLINE_BYTES, base64ByteLength, normaliseBase64 } from "@/lib/attachment-content";

export const WHATSAPP_DOCUMENT_CAPTION_MAX = 1024;
export const DOCUMENT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_WHATSAPP_DOCUMENTS_PER_SEND = 5;
export const MAX_INLINE_WHATSAPP_DOCUMENT_BYTES = MAX_JSON_INLINE_BYTES;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const DATA_URL_PREFIX = /^data:[^,]*,/i;

export type BodyDelivery = "caption" | "separate";

export type WhatsAppAttachmentDescriptor =
  | { kind: "inline"; filename: string; contentType: string; dataBase64: string }
  | { kind: "dealDocument"; dealDocumentId: string; filename?: string };

export class WhatsAppDocumentInputError extends Error {
  readonly status: 400 | 404 | 413;
  constructor(message: string, status: 400 | 404 | 413) {
    super(message);
    this.name = "WhatsAppDocumentInputError";
    this.status = status;
  }
}

export interface ParsedWhatsAppSend {
  body: string;
  attachments: WhatsAppAttachmentDescriptor[];
  /** Set only when the caller chose one. Otherwise the sender picks. */
  bodyDelivery?: BodyDelivery;
  idempotencyKey?: string;
}

export function inlineWhatsAppDocumentTooLargeMessage(): string {
  return (
    `Attachment too large for an inline JSON upload (max ${MAX_INLINE_WHATSAPP_DOCUMENT_BYTES} bytes decoded, 3 MB). ` +
    "Base64 of a larger file exceeds Vercel's ~4.5 MB request limit. " +
    "Store the PDF on the deal and pass dealDocumentId so the server reads it from storage."
  );
}

export function safeDocumentFilename(name: string, mimeType: string): string {
  const cleaned = name.replace(/[/\\]/g, " ").replace(/[\u0000-\u001f]/g, "").trim();
  const cut = cleaned.slice(0, 180);
  const base = cut || "dokument";
  if (base.includes(".")) return base;
  if (mimeType.split(";")[0]?.trim().toLowerCase() === "application/pdf") return `${base}.pdf`;
  return base;
}

export function documentSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function resolveBodyDelivery(body: string, requested?: BodyDelivery): BodyDelivery {
  if (requested) return requested;
  if (!body.trim()) return "caption";
  if (body.length > WHATSAPP_DOCUMENT_CAPTION_MAX) return "separate";
  return "caption";
}

/** Caption placed on the first document, or undefined when the text goes out on its own. */
export function captionForDocument(body: string, delivery: BodyDelivery, index: number): string | undefined {
  if (delivery !== "caption" || index !== 0) return undefined;
  const text = body.trim();
  return text || undefined;
}

export interface OutboundDocumentMarker {
  kind: "whatsapp_document";
  documentSha256: string;
  idempotencyKey: string | null;
}

export function outboundDocumentHeaders(marker: {
  documentSha256: string;
  idempotencyKey?: string;
}): string {
  const payload: OutboundDocumentMarker = {
    kind: "whatsapp_document",
    documentSha256: marker.documentSha256,
    idempotencyKey: marker.idempotencyKey ?? null,
  };
  return JSON.stringify(payload);
}

export function parseOutboundDocumentHeaders(raw: string | null | undefined): OutboundDocumentMarker | null {
  if (!raw || !raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OutboundDocumentMarker>;
    if (parsed.kind !== "whatsapp_document") return null;
    if (typeof parsed.documentSha256 !== "string" || !parsed.documentSha256) return null;
    return {
      kind: "whatsapp_document",
      documentSha256: parsed.documentSha256,
      idempotencyKey: typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : null,
    };
  } catch {
    return null;
  }
}

export function duplicateDocumentHit(
  rows: ReadonlyArray<{ id: string; rawHeaders: string | null; sentAt: Date | string | null }>,
  opts: { sha256: string; idempotencyKey?: string; now: Date }
): { messageId: string; reason: "idempotency" | "dedupe" } | null {
  const key = opts.idempotencyKey;
  for (const row of rows) {
    const marker = parseOutboundDocumentHeaders(row.rawHeaders);
    if (!marker) continue;
    if (key && marker.idempotencyKey === key) {
      return { messageId: row.id, reason: "idempotency" };
    }
  }
  const cutoff = opts.now.getTime() - DOCUMENT_DEDUPE_WINDOW_MS;
  for (const row of rows) {
    const marker = parseOutboundDocumentHeaders(row.rawHeaders);
    if (!marker || marker.documentSha256 !== opts.sha256) continue;
    const sent = row.sentAt ? new Date(row.sentAt).getTime() : 0;
    if (sent >= cutoff) return { messageId: row.id, reason: "dedupe" };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOneAttachment(value: unknown, index: number): WhatsAppAttachmentDescriptor {
  const row = asRecord(value);
  if (!row) {
    throw new WhatsAppDocumentInputError(`attachments[${index}] must be an object`, 400);
  }
  const dealDocumentId = typeof row.dealDocumentId === "string" ? row.dealDocumentId.trim() : "";
  const dataBase64 = typeof row.dataBase64 === "string" ? row.dataBase64 : "";
  if (dealDocumentId && dataBase64.trim()) {
    throw new WhatsAppDocumentInputError(
      `attachments[${index}] must be either inline bytes or a dealDocumentId, not both`,
      400
    );
  }
  if (dealDocumentId) {
    const filename = typeof row.filename === "string" ? row.filename.trim() : "";
    return filename
      ? { kind: "dealDocument", dealDocumentId, filename }
      : { kind: "dealDocument", dealDocumentId };
  }
  if (!dataBase64.trim()) {
    throw new WhatsAppDocumentInputError(
      `attachments[${index}] needs {filename, contentType, dataBase64} or {dealDocumentId}`,
      400
    );
  }
  const filename = typeof row.filename === "string" ? row.filename.trim() : "";
  const contentType = typeof row.contentType === "string" ? row.contentType.trim() : "";
  if (!filename || !contentType) {
    throw new WhatsAppDocumentInputError(
      `attachments[${index}] inline file needs filename and contentType`,
      400
    );
  }
  const normalised = normaliseBase64(dataBase64.trim().replace(DATA_URL_PREFIX, ""));
  if (!normalised || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalised)) {
    throw new WhatsAppDocumentInputError(`attachments[${index}] dataBase64 is not valid base64`, 400);
  }
  const decoded = base64ByteLength(normalised);
  if (decoded <= 0) {
    throw new WhatsAppDocumentInputError(`attachments[${index}] is empty`, 400);
  }
  if (decoded > MAX_INLINE_WHATSAPP_DOCUMENT_BYTES) {
    throw new WhatsAppDocumentInputError(inlineWhatsAppDocumentTooLargeMessage(), 413);
  }
  return { kind: "inline", filename, contentType, dataBase64: normalised };
}

/**
 * Reads the shared send body. No attachments leaves body required for the
 * caller (this returns body "" when missing — the route still demands text
 * when the list is empty).
 */
export function parseWhatsAppSendPayload(payload: unknown): ParsedWhatsAppSend {
  const body = asRecord(payload) ?? {};
  const text = typeof body.body === "string" ? body.body.trim() : "";
  let bodyDelivery: BodyDelivery | undefined;
  if (body.bodyDelivery !== undefined && body.bodyDelivery !== null && body.bodyDelivery !== "") {
    if (body.bodyDelivery !== "caption" && body.bodyDelivery !== "separate") {
      throw new WhatsAppDocumentInputError("bodyDelivery must be caption or separate", 400);
    }
    bodyDelivery = body.bodyDelivery;
  }
  let idempotencyKey: string | undefined;
  if (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()) {
    const key = body.idempotencyKey.trim();
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new WhatsAppDocumentInputError(
        "idempotencyKey must be 1–200 characters of letters, digits, dot, colon, underscore or hyphen",
        400
      );
    }
    idempotencyKey = key;
  }
  if (body.attachments === undefined || body.attachments === null) {
    return { body: text, attachments: [], bodyDelivery, idempotencyKey };
  }
  if (!Array.isArray(body.attachments)) {
    throw new WhatsAppDocumentInputError("attachments must be an array", 400);
  }
  if (body.attachments.length > MAX_WHATSAPP_DOCUMENTS_PER_SEND) {
    throw new WhatsAppDocumentInputError(
      `at most ${MAX_WHATSAPP_DOCUMENTS_PER_SEND} attachments per send`,
      400
    );
  }
  const attachments = body.attachments.map((item, index) => parseOneAttachment(item, index));
  if (bodyDelivery === "caption" && text.length > WHATSAPP_DOCUMENT_CAPTION_MAX) {
    throw new WhatsAppDocumentInputError(
      `body is longer than ${WHATSAPP_DOCUMENT_CAPTION_MAX} characters; pass bodyDelivery separate so it is sent as its own text`,
      400
    );
  }
  return { body: text, attachments, bodyDelivery, idempotencyKey };
}
