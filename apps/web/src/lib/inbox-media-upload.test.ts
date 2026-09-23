import { describe, expect, it } from "vitest";
import {
  INBOX_DIRECT_UPLOAD_MAX_BYTES,
  isInboxMediaBlobPath,
  isVercelBlobUrl,
} from "./inbox-media-upload";

describe("inbox media upload guards", () => {
  it("keeps the direct upload under Vercel's 4.5 MB request cap", () => {
    expect(INBOX_DIRECT_UPLOAD_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("accepts only this conversation's private blob path", () => {
    const id = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";
    expect(isInboxMediaBlobPath(`inbox/conv/${id}/AB.pdf`, id)).toBe(true);
    expect(isInboxMediaBlobPath(`inbox/conv/other/AB.pdf`, id)).toBe(false);
    expect(isInboxMediaBlobPath("https://example.com/AB.pdf", id)).toBe(false);
  });

  it("accepts only Vercel Blob HTTPS urls", () => {
    expect(
      isVercelBlobUrl("https://store.private.blob.vercel-storage.com/inbox/conv/x/AB.pdf")
    ).toBe(true);
    expect(isVercelBlobUrl("http://store.private.blob.vercel-storage.com/a")).toBe(false);
    expect(isVercelBlobUrl("https://evil.example/blob.vercel-storage.com")).toBe(false);
  });
});
