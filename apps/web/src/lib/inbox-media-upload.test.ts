import { beforeEach, describe, expect, it, vi } from "vitest";
import { put } from "@vercel/blob/client";
import {
  INBOX_BLOB_MAX_BYTES,
  INBOX_BRIDGE_BODY_LIMIT_BYTES,
  INBOX_DIRECT_UPLOAD_MAX_BYTES,
  INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE,
  inboxBridgeJsonBytes,
  inboxMediaFitsBridge,
  inboxMediaUploadFailureMessage,
  isInboxMediaBlobPath,
  isVercelBlobUrl,
  uploadInboxMediaBlob,
} from "./inbox-media-upload";
import {
  describeInboxMediaUploadError,
  redactInboxMediaSecrets,
} from "./inbox-media-upload-error";

vi.mock("@vercel/blob/client", () => ({
  put: vi.fn(),
}));

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

  it("fits a 20 MB file in the 30 MiB bridge body and rejects one that does not", () => {
    expect(INBOX_BRIDGE_BODY_LIMIT_BYTES).toBe(30 * 1024 * 1024);
    expect(inboxMediaFitsBridge(INBOX_BLOB_MAX_BYTES, 8 * 1024)).toBe(true);
    expect(inboxMediaFitsBridge(23 * 1024 * 1024, 8 * 1024)).toBe(false);
  });

  it("matches the JSON byte length of a base64 media body", () => {
    const file = Buffer.from("Rechnung 2026 — Ümlaut");
    const mediaBase64 = file.toString("base64");
    const body = {
      kind: "document",
      peerWaId: "491511112233@s.whatsapp.net",
      mediaBase64,
      mimeType: "application/pdf",
      fileName: "Rechnung.pdf",
      caption: "Bitte ansehen",
    };
    const envelope = Buffer.byteLength(JSON.stringify({ ...body, mediaBase64: "" }));
    expect(inboxBridgeJsonBytes(file.length, envelope)).toBe(Buffer.byteLength(JSON.stringify(body)));
    expect(inboxBridgeJsonBytes(0, envelope)).toBe(envelope);
  });

  it("names the upload check and hides the blob token", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(describeInboxMediaUploadError(new Error("BLOB_READ_WRITE_TOKEN is not set"))).toEqual({
      check: "missing BLOB_READ_WRITE_TOKEN",
      message: "BLOB_READ_WRITE_TOKEN is not set",
      clientMessage: INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE,
    });
    expect(describeInboxMediaUploadError(new Error("Nicht angemeldet.")).check).toBe("auth");
    expect(describeInboxMediaUploadError(new Error("Ungültiger Upload-Pfad.")).check).toBe("path");
    expect(describeInboxMediaUploadError(new Error("Unterhaltung nicht gefunden.")).check).toBe(
      "conversation",
    );

    const secret = "vercel_blob_rw_store_SUPERSECRET";
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", secret);
    const failure = describeInboxMediaUploadError(
      new Error(`Invalid \`BLOB_READ_WRITE_TOKEN\` leaked ${secret}`),
    );
    expect(failure.check).toBe("missing BLOB_READ_WRITE_TOKEN");
    expect(failure.clientMessage).toContain("ungültig");
    expect(failure.message).not.toContain("SUPERSECRET");
    expect(failure.clientMessage).not.toContain("SUPERSECRET");
    expect(redactInboxMediaSecrets(`token ${secret}`)).toBe("token [redacted]");
    vi.unstubAllEnvs();
  });

  it("accepts only Vercel Blob HTTPS urls", () => {
    expect(
      isVercelBlobUrl("https://store.private.blob.vercel-storage.com/inbox/conv/x/AB.pdf")
    ).toBe(true);
    expect(isVercelBlobUrl("http://store.private.blob.vercel-storage.com/a")).toBe(false);
    expect(isVercelBlobUrl("https://evil.example/blob.vercel-storage.com")).toBe(false);
  });
});

describe("uploadInboxMediaBlob", () => {
  beforeEach(() => {
    vi.mocked(put).mockReset();
  });

  it("throws the token route's message instead of the generic blob client error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE }, { status: 400 }),
      ),
    );
    await expect(
      uploadInboxMediaBlob({
        pathname: "inbox/conv/c1/a.pdf",
        file: new Blob(["pdf"]),
        contentType: "application/pdf",
        multipart: false,
      }),
    ).rejects.toThrow(INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE);
    expect(put).not.toHaveBeenCalled();
    expect(inboxMediaUploadFailureMessage({ error: "" })).toBe(
      "Upload-Token konnte nicht erstellt werden.",
    );
  });

  it("uploads with the client token from the route", async () => {
    vi.mocked(put).mockResolvedValue({
      url: "https://store.private.blob.vercel-storage.com/inbox/conv/c1/a.pdf",
      pathname: "inbox/conv/c1/a.pdf",
    } as Awaited<ReturnType<typeof put>>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ clientToken: "vercel_blob_client_ok" })),
    );
    const file = new Blob(["pdf"]);
    const uploaded = await uploadInboxMediaBlob({
      pathname: "inbox/conv/c1/a.pdf",
      file,
      contentType: "application/pdf",
      multipart: true,
    });
    expect(uploaded.url).toContain("blob.vercel-storage.com");
    expect(put).toHaveBeenCalledWith("inbox/conv/c1/a.pdf", file, {
      access: "private",
      token: "vercel_blob_client_ok",
      contentType: "application/pdf",
      multipart: true,
    });
  });
});
