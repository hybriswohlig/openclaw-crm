import { describe, expect, it } from "vitest";
import {
  MAX_JSON_INLINE_BYTES,
  MAX_MCP_INLINE_BYTES,
  MAX_MCP_INLINE_BYTES_LIMIT,
  base64ByteLength,
  isRenderableImage,
  normaliseBase64,
  normaliseImageMime,
  resolveMaxBytes,
  toAttachmentPayload,
  type AttachmentRow,
} from "./attachment-content";

// Unit coverage for the helpers behind the JSON attachment routes.
//
// Regression being pinned: MCP agents could list a deal's attachments but never
// get the pixels — the only byte route streamed raw binary and the JSON-only
// client died with INVALID_JSON. The fix hands the stored base64 back inside a
// JSON envelope, so the load-bearing property of this module is that it decides
// *about* the bytes (mime, size, ceiling) without ever touching them.

describe("isRenderableImage", () => {
  it("accepts the four mime types a vision content block can render", () => {
    expect(isRenderableImage("image/jpeg")).toBe(true);
    expect(isRenderableImage("image/png")).toBe(true);
    expect(isRenderableImage("image/webp")).toBe(true);
    expect(isRenderableImage("image/gif")).toBe(true);
  });

  it("ignores mime parameters", () => {
    // `file` and some mail gateways stamp a charset onto binary types; the raw
    // header would then miss an exact-match lookup and a real JPEG would be
    // demoted to a non-image blob.
    expect(isRenderableImage("image/jpeg; charset=binary")).toBe(true);
    expect(isRenderableImage("IMAGE/PNG")).toBe(true);
  });

  it("accepts the bogus-but-real-world image/jpg", () => {
    // Not a registered mime type, but WhatsApp and several mail clients send it
    // — treating it as "not an image" is how customer photos went unrendered.
    expect(isRenderableImage("image/jpg")).toBe(true);
  });

  it("rejects everything a vision content block would choke on", () => {
    // These still get their base64 in the payload; they just must not be
    // advertised as renderable, because a client that tries errors the call.
    expect(isRenderableImage("application/pdf")).toBe(false);
    expect(isRenderableImage("audio/ogg")).toBe(false);
    expect(isRenderableImage("image/heic")).toBe(false);
    expect(isRenderableImage("text/html")).toBe(false);
    expect(isRenderableImage("")).toBe(false);
  });
});

describe("normaliseImageMime", () => {
  it("canonicalises image/jpg to image/jpeg", () => {
    expect(normaliseImageMime("image/jpg")).toBe("image/jpeg");
  });

  it("strips parameters", () => {
    expect(normaliseImageMime("image/jpeg; charset=binary")).toBe("image/jpeg");
    expect(normaliseImageMime("image/png;")).toBe("image/png");
  });

  it("lowercases", () => {
    expect(normaliseImageMime("IMAGE/WEBP")).toBe("image/webp");
    expect(normaliseImageMime("Image/JPG")).toBe("image/jpeg");
  });

  it("leaves an already-canonical mime alone", () => {
    expect(normaliseImageMime("image/png")).toBe("image/png");
  });
});

describe("normaliseBase64", () => {
  it("strips newlines, CRLFs, spaces and tabs", () => {
    const clean = Buffer.from("hello world, and then some").toString("base64");
    expect(normaliseBase64(clean.replace(/(.{8})/g, "$1\n"))).toBe(clean);
    expect(normaliseBase64(clean.replace(/(.{8})/g, "$1\r\n"))).toBe(clean);
    expect(normaliseBase64(clean.replace(/(.{8})/g, "$1 "))).toBe(clean);
    expect(normaliseBase64(clean.replace(/(.{8})/g, "$1\t"))).toBe(clean);
    expect(normaliseBase64(" \t\r\n" + clean + "\n ")).toBe(clean);
  });

  it("returns the very same string when there is nothing to strip", () => {
    // Identity, not just equality: every attachment this codebase writes comes
    // from Buffer.toString("base64") and is already clean, so the common path
    // must not copy a multi-megabyte string on every request.
    const clean = Buffer.alloc(4096, 3).toString("base64");
    expect(normaliseBase64(clean)).toBe(clean);
    expect(Object.is(normaliseBase64(clean), clean)).toBe(true);
  });

  it("leaves the empty string alone", () => {
    expect(normaliseBase64("")).toBe("");
  });
});

describe("base64ByteLength", () => {
  // The helper exists to size a payload without allocating a Buffer for it, so
  // its only contract is: agree with Buffer, always.
  const fixtures: Array<[label: string, b64: string]> = [
    ["the empty string", ""],
    ["two '=' padding chars", Buffer.from("a").toString("base64")],
    ["one '=' padding char", Buffer.from("ab").toString("base64")],
    ["no padding chars", Buffer.from("abc").toString("base64")],
    ["a short ASCII payload", Buffer.from("hello world").toString("base64")],
    ["a JPEG header", Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")],
    ["a 1 KB payload", Buffer.alloc(1024, 7).toString("base64")],
  ];

  for (const [label, b64] of fixtures) {
    it(`matches Buffer for ${label}`, () => {
      expect(base64ByteLength(b64)).toBe(Buffer.from(b64, "base64").length);
    });
  }

  it("matches Buffer for every payload size from 0 to 40 bytes", () => {
    // Deterministic pseudo-random content so a failure is reproducible; the
    // byte values are irrelevant to the length maths, only the count matters.
    for (let n = 0; n <= 40; n++) {
      const buf = Buffer.from(Array.from({ length: n }, (_, i) => i % 251));
      const b64 = buf.toString("base64");
      expect(base64ByteLength(b64)).toBe(buf.length);
      expect(base64ByteLength(b64)).toBe(Buffer.from(b64, "base64").length);
    }
  });
});

describe("inline byte ceilings", () => {
  it("collapses every MCP ceiling onto the JSON transport ceiling", () => {
    // The JSON body is the narrowest pipe: NextResponse.json buffers it whole
    // and base64 inflates by 4/3. Letting an MCP caller raise `maxBytes` past
    // what the REST route can actually return would only swap an honest 413 for
    // a platform HTML error page, so all three constants are one number.
    expect(MAX_MCP_INLINE_BYTES).toBe(MAX_JSON_INLINE_BYTES);
    expect(MAX_MCP_INLINE_BYTES_LIMIT).toBe(MAX_JSON_INLINE_BYTES);
  });

  it("keeps the ceiling under a 4.5 MB non-streaming response cap once base64-inflated", () => {
    // 4/3 inflation plus the JSON envelope has to fit; this is the property the
    // number was chosen for, asserted symbolically so it survives a re-tune.
    expect(Math.ceil((MAX_JSON_INLINE_BYTES * 4) / 3)).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe("resolveMaxBytes", () => {
  it("falls back to the default for a missing or nonsensical request", () => {
    expect(resolveMaxBytes(undefined)).toBe(MAX_MCP_INLINE_BYTES);
    expect(resolveMaxBytes(0)).toBe(MAX_MCP_INLINE_BYTES);
    expect(resolveMaxBytes(-1)).toBe(MAX_MCP_INLINE_BYTES);
    expect(resolveMaxBytes(Number.NaN)).toBe(MAX_MCP_INLINE_BYTES);
  });

  it("honours a smaller caller-supplied ceiling", () => {
    expect(resolveMaxBytes(1024)).toBe(1024);
    expect(resolveMaxBytes(MAX_MCP_INLINE_BYTES - 1)).toBe(MAX_MCP_INLINE_BYTES - 1);
  });

  it("clamps anything above the hard limit", () => {
    // A caller must not be able to talk us into stuffing a 500 MB attachment
    // through a JSON-RPC response by asking nicely.
    expect(resolveMaxBytes(MAX_MCP_INLINE_BYTES_LIMIT + 1)).toBe(
      MAX_MCP_INLINE_BYTES_LIMIT
    );
    expect(resolveMaxBytes(Number.MAX_SAFE_INTEGER)).toBe(MAX_MCP_INLINE_BYTES_LIMIT);
    expect(resolveMaxBytes(Number.POSITIVE_INFINITY)).toBe(MAX_MCP_INLINE_BYTES);
  });

  it("floors a float so the result is a whole number of bytes", () => {
    expect(resolveMaxBytes(1024.9)).toBe(1024);
    expect(resolveMaxBytes(0.5)).toBe(0);
  });
});

describe("toAttachmentPayload", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const JPEG_BASE64 = JPEG.toString("base64");

  function row(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
    return {
      id: "att_1",
      fileName: "kueche.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
      fileContent: JPEG_BASE64,
      transcript: null,
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      conversationId: "conv_1",
      messageId: "msg_1",
      dealRecordId: "deal_1",
      ...overrides,
    };
  }

  it("maps a row field by field", () => {
    expect(toAttachmentPayload(row())).toEqual({
      id: "att_1",
      fileName: "kueche.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
      contentBase64: JPEG_BASE64,
      isImage: true,
      conversationId: "conv_1",
      messageId: "msg_1",
      dealRecordId: "deal_1",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("passes whitespace-free fileContent through as contentBase64 unchanged", () => {
    // `inbox_message_attachments.file_content` is ALREADY base64. Running it
    // through Buffer again would double-encode and the agent would decode a
    // base64 string instead of a JPEG — identity is the whole contract here,
    // and normaliseBase64 must not break it for the ordinary clean row.
    const stored = row();
    const payload = toAttachmentPayload(stored);
    expect(payload.contentBase64).toBe(stored.fileContent);
    expect(Object.is(payload.contentBase64, stored.fileContent)).toBe(true);
    expect(Buffer.from(payload.contentBase64, "base64").subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff])
    );
  });

  it("unwraps 76-char-wrapped base64 into a single line", () => {
    // The Baileys bridge posts `fileContentBase64` from a separate deployment
    // and it is stored verbatim, so a PEM-style wrapped string can reach us.
    // Left wrapped it breaks twice: base64ByteLength counts the newlines as
    // payload (mis-sizing the 413 gate) and the MCP SDK's z.string().base64()
    // rejects the value outright, so the agent gets a schema error, not bytes.
    const wrapped = JPEG_BASE64.replace(/(.{4})/g, "$1\n");
    const payload = toAttachmentPayload(row({ fileContent: wrapped }));

    expect(payload.contentBase64).toBe(JPEG_BASE64);
    expect(payload.contentBase64).not.toMatch(/\s/);
    expect(Buffer.from(payload.contentBase64, "base64").equals(JPEG)).toBe(true);
  });

  it("makes base64ByteLength agree with Buffer for a wrapped row once normalised", () => {
    // A 76-char-wrapped 1 KB payload carries ~18 newlines; unnormalised that is
    // ~13 phantom bytes of reported size.
    const buf = Buffer.alloc(1024, 9);
    const wrapped = buf.toString("base64").replace(/(.{76})/g, "$1\n");
    const payload = toAttachmentPayload(row({ fileContent: wrapped }));

    expect(base64ByteLength(payload.contentBase64)).toBe(
      Buffer.from(payload.contentBase64, "base64").length
    );
    expect(base64ByteLength(payload.contentBase64)).toBe(buf.length);
    // And the un-normalised string is exactly the trap being avoided.
    expect(base64ByteLength(wrapped)).toBeGreaterThan(buf.length);
  });

  it("serialises a Date createdAt to ISO", () => {
    // NextResponse.json() would stringify a Date anyway, but the payload type
    // promises a string so downstream code can compare without re-parsing.
    const payload = toAttachmentPayload(row({ createdAt: new Date(0) }));
    expect(payload.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("passes a string createdAt through", () => {
    const payload = toAttachmentPayload(row({ createdAt: "2026-08-01T10:00:00.000Z" }));
    expect(payload.createdAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("maps a null dealRecordId to null (never undefined)", () => {
    // undefined would drop the key from the JSON body entirely; an agent asking
    // "which deal is this on?" needs an explicit null, not a missing field.
    const payload = toAttachmentPayload(row({ dealRecordId: null }));
    expect(payload.dealRecordId).toBeNull();
    expect("dealRecordId" in payload).toBe(true);
  });

  it("maps an undefined dealRecordId to null", () => {
    const payload = toAttachmentPayload(row({ dealRecordId: undefined }));
    expect(payload.dealRecordId).toBeNull();
  });

  it("omits transcript when it is null or empty", () => {
    expect("transcript" in toAttachmentPayload(row({ transcript: null }))).toBe(false);
    expect("transcript" in toAttachmentPayload(row({ transcript: "" }))).toBe(false);
    expect("transcript" in toAttachmentPayload(row({ transcript: undefined }))).toBe(
      false
    );
  });

  it("includes transcript when the transcribe cron has filled it in", () => {
    const payload = toAttachmentPayload(
      row({ mimeType: "audio/ogg", transcript: "Hallo, wir ziehen im September um." })
    );
    expect(payload.transcript).toBe("Hallo, wir ziehen im September um.");
  });

  it("derives isImage from the mime type", () => {
    expect(toAttachmentPayload(row({ mimeType: "image/jpg" })).isImage).toBe(true);
    expect(toAttachmentPayload(row({ mimeType: "application/pdf" })).isImage).toBe(false);
    expect(toAttachmentPayload(row({ mimeType: "audio/ogg" })).isImage).toBe(false);
  });

  it("reports the mime type verbatim even when isImage normalised it", () => {
    // The payload must not lie about what the DB holds; only `isImage` is the
    // normalised view of the mime.
    const payload = toAttachmentPayload(row({ mimeType: "image/jpg" }));
    expect(payload.mimeType).toBe("image/jpg");
    expect(payload.isImage).toBe(true);
  });
});
