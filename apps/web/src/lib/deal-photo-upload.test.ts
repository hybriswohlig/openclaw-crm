import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_JSON_INLINE_BYTES } from "@/lib/attachment-content";
import {
  MAX_DEAL_PHOTO_BYTES,
  contentSha256Hex,
  dealPhotoSource,
  isCustomerVisibleDealPhoto,
  isDealSurfacePhoto,
  jsonDealPhotoBatchTooLargeMessage,
  jsonDealPhotoTooLargeMessage,
  prepareDealPhotoUploads,
  sniffImageMime,
} from "./deal-photo-upload";

function jpeg(size: number): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("deal photo JSON upload rules", () => {
  it("caps one photo at 3 MB so the base64 body stays under Vercel's 4.5 MB limit", () => {
    expect(MAX_DEAL_PHOTO_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_DEAL_PHOTO_BYTES).toBe(MAX_JSON_INLINE_BYTES);
    expect(Math.ceil((MAX_DEAL_PHOTO_BYTES * 4) / 3)).toBeLessThan(4.5 * 1024 * 1024);
    expect(jsonDealPhotoTooLargeMessage()).toContain(String(MAX_DEAL_PHOTO_BYTES));
  });

  it("keeps the MCP pre-check sentence identical", () => {
    const mcp = readFileSync(
      new URL("../../../mcp/src/lib/deal-photo-upload.ts", import.meta.url),
      "utf8"
    );
    expect(mcp).toContain("export const MAX_JSON_DEAL_PHOTO_BYTES = 3 * 1024 * 1024");
    expect(mcp).toContain(
      "Photo too large for JSON upload (max ${MAX_JSON_DEAL_PHOTO_BYTES} bytes decoded, 3 MB)."
    );
    expect(mcp).toContain(
      "Base64 of a larger photo exceeds Vercel's ~4.5 MB request limit and is not stored."
    );
  });

  it("accepts a jpeg, including a data-URL prefix and image/jpg", () => {
    const bytes = jpeg(32);
    const prepared = prepareDealPhotoUploads({
      filename: "küche.jpg",
      contentType: "image/jpg",
      dataBase64: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.photos).toHaveLength(1);
    expect(prepared.photos[0]).toMatchObject({
      fileName: "küche.jpg",
      mimeType: "image/jpeg",
      fileSize: 32,
      contentSha256: contentSha256Hex(bytes),
    });
  });

  it("accepts a batch of photos", () => {
    const prepared = prepareDealPhotoUploads({
      photos: [
        { filename: "a.jpg", contentType: "image/jpeg", dataBase64: jpeg(16).toString("base64") },
        { filename: "b.png", contentType: "image/png", dataBase64: PNG.toString("base64") },
      ],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.photos.map((p) => p.mimeType)).toEqual(["image/jpeg", "image/png"]);
  });

  it("rejects a PDF even when the mime type says jpeg", () => {
    const prepared = prepareDealPhotoUploads({
      filename: "rechnung.jpg",
      contentType: "image/jpeg",
      dataBase64: Buffer.from("%PDF-1.4").toString("base64"),
    });
    expect(prepared).toMatchObject({ ok: false, status: 400, code: "NOT_AN_IMAGE" });
  });

  it("rejects a non-image mime type", () => {
    const prepared = prepareDealPhotoUploads({
      filename: "note.txt",
      contentType: "text/plain",
      dataBase64: Buffer.from("hello").toString("base64"),
    });
    expect(prepared).toMatchObject({ ok: false, status: 400, code: "UNSUPPORTED_TYPE" });
  });

  it("rejects one byte over the per-photo cap and stores nothing", () => {
    const prepared = prepareDealPhotoUploads({
      filename: "gross.jpg",
      contentType: "image/jpeg",
      dataBase64: jpeg(MAX_DEAL_PHOTO_BYTES + 1).toString("base64"),
    });
    expect(prepared).toMatchObject({
      ok: false,
      status: 413,
      code: "FILE_TOO_LARGE",
      error: jsonDealPhotoTooLargeMessage(),
    });
  });

  it("accepts a photo of exactly the cap", () => {
    const prepared = prepareDealPhotoUploads({
      filename: "genau.jpg",
      contentType: "image/jpeg",
      dataBase64: jpeg(MAX_DEAL_PHOTO_BYTES).toString("base64"),
    });
    expect(prepared.ok).toBe(true);
  });

  it("rejects a batch whose decoded total exceeds 3 MB", () => {
    const half = Math.floor(MAX_DEAL_PHOTO_BYTES / 2) + 1;
    const prepared = prepareDealPhotoUploads({
      photos: [
        { filename: "a.jpg", contentType: "image/jpeg", dataBase64: jpeg(half).toString("base64") },
        { filename: "b.jpg", contentType: "image/jpeg", dataBase64: jpeg(half).toString("base64") },
      ],
    });
    expect(prepared).toMatchObject({
      ok: false,
      status: 413,
      error: jsonDealPhotoBatchTooLargeMessage(),
    });
  });

  it("recognises png and heic headers", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    const heic = Buffer.alloc(12);
    heic.write("ftyp", 4, "ascii");
    heic.write("heic", 8, "ascii");
    expect(sniffImageMime(heic)).toBe("image/heic");
  });
});

describe("deal photo visibility", () => {
  it("shows customer and portal photos to the customer, and keeps agent uploads internal", () => {
    expect(
      isCustomerVisibleDealPhoto({ direction: "inbound", externalMessageId: "wamid.1" })
    ).toBe(true);
    expect(
      isCustomerVisibleDealPhoto({
        direction: "outbound",
        externalMessageId: "portal-upload:abc",
      })
    ).toBe(true);
    expect(
      isCustomerVisibleDealPhoto({
        direction: "outbound",
        externalMessageId: "internal-photo:abc",
      })
    ).toBe(false);
    expect(
      isDealSurfacePhoto({ direction: "outbound", externalMessageId: "internal-photo:abc" })
    ).toBe(true);
    expect(
      dealPhotoSource({ direction: "outbound", externalMessageId: "internal-photo:abc" })
    ).toBe("internal");
    expect(
      dealPhotoSource({ direction: "outbound", externalMessageId: "portal-upload:abc" })
    ).toBe("operator");
    expect(dealPhotoSource({ direction: "inbound", externalMessageId: "wamid.1" })).toBe(
      "customer"
    );
  });
});
