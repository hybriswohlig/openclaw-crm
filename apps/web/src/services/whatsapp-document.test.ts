import { describe, expect, it } from "vitest";
import {
  DOCUMENT_DEDUPE_WINDOW_MS,
  MAX_INLINE_WHATSAPP_DOCUMENT_BYTES,
  WhatsAppDocumentInputError,
  captionForDocument,
  duplicateDocumentHit,
  parseWhatsAppSendPayload,
  resolveBodyDelivery,
} from "./whatsapp-document";

describe("parseWhatsAppSendPayload", () => {
  it("keeps a text-only body", () => {
    expect(parseWhatsAppSendPayload({ body: " Hallo " })).toEqual({
      body: "Hallo",
      attachments: [],
      bodyDelivery: undefined,
      idempotencyKey: undefined,
    });
  });

  it("accepts a deal document or inline bytes, not both", () => {
    expect(parseWhatsAppSendPayload({
      attachments: [{ dealDocumentId: "doc-1", filename: "Angebot.pdf" }],
    }).attachments).toEqual([
      { kind: "dealDocument", dealDocumentId: "doc-1", filename: "Angebot.pdf" },
    ]);

    const inline = parseWhatsAppSendPayload({
      attachments: [{
        filename: "note.txt",
        contentType: "text/plain",
        dataBase64: "data:text/plain;base64,aGVsbG8=",
      }],
    });
    expect(inline.attachments).toEqual([
      { kind: "inline", filename: "note.txt", contentType: "text/plain", dataBase64: "aGVsbG8=" },
    ]);

    expect(() => parseWhatsAppSendPayload({
      attachments: [{ dealDocumentId: "doc-1", filename: "a.pdf", contentType: "application/pdf", dataBase64: "YQ==" }],
    })).toThrow(WhatsAppDocumentInputError);
  });

  it("rejects an inline file over 3 MB decoded", () => {
    const dataBase64 = "A".repeat(Math.ceil((MAX_INLINE_WHATSAPP_DOCUMENT_BYTES + 1) / 3) * 4);
    expect(() => parseWhatsAppSendPayload({
      attachments: [{ filename: "big.pdf", contentType: "application/pdf", dataBase64 }],
    })).toThrow(/dealDocumentId/);
  });

  it("rejects caption text over 1024 characters and a bad idempotency key", () => {
    expect(() => parseWhatsAppSendPayload({
      body: "x".repeat(1025),
      bodyDelivery: "caption",
      attachments: [{ dealDocumentId: "doc-1" }],
    })).toThrow(/bodyDelivery separate/);
    expect(() => parseWhatsAppSendPayload({ idempotencyKey: "has space" })).toThrow(/idempotencyKey/);
  });
});

describe("document delivery", () => {
  it("uses a caption for a short body and a separate text when it is long", () => {
    expect(resolveBodyDelivery("kurz")).toBe("caption");
    expect(resolveBodyDelivery("x".repeat(1025))).toBe("separate");
    expect(captionForDocument("Hallo", "caption", 0)).toBe("Hallo");
    expect(captionForDocument("Hallo", "caption", 1)).toBeUndefined();
    expect(captionForDocument("Hallo", "separate", 0)).toBeUndefined();
  });

  it("matches an idempotency key at any age and a hash only inside the window", () => {
    const now = new Date("2026-10-16T12:00:00.000Z");
    const rows = [
      {
        id: "old",
        rawHeaders: JSON.stringify({ kind: "whatsapp_document", documentSha256: "abc", idempotencyKey: "k1" }),
        sentAt: new Date(now.getTime() - DOCUMENT_DEDUPE_WINDOW_MS - 1000),
      },
    ];
    expect(duplicateDocumentHit(rows, { sha256: "zzz", idempotencyKey: "k1", now })).toEqual({
      messageId: "old",
      reason: "idempotency",
    });
    expect(duplicateDocumentHit(rows, { sha256: "abc", now })).toBeNull();
    rows[0]!.sentAt = now;
    expect(duplicateDocumentHit(rows, { sha256: "abc", now })).toEqual({ messageId: "old", reason: "dedupe" });
  });
});
