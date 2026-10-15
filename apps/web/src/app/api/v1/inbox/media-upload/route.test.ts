import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE } from "@/lib/inbox-media-upload";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  handleUpload: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: mocks.handleUpload,
  put: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.limit,
        }),
      }),
    }),
  },
}));

import { POST } from "./route";

const CONV = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

function tokenRequest(pathname = `inbox/conv/${CONV}/angebot.pdf`) {
  return POST(
    new NextRequest("https://crm.test/api/v1/inbox/media-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname, clientPayload: null, multipart: false },
      }),
    }),
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store_configured");
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: "ws_kottke",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "session",
  });
  mocks.limit.mockResolvedValue([{ id: CONV }]);
  mocks.handleUpload.mockImplementation(
    async (args: {
      body: {
        type: string;
        payload: { pathname: string; clientPayload: string | null; multipart: boolean };
      };
      onBeforeGenerateToken: (
        pathname: string,
        clientPayload: string | null,
        multipart: boolean,
      ) => Promise<unknown>;
    }) => {
      await args.onBeforeGenerateToken(
        args.body.payload.pathname,
        args.body.payload.clientPayload,
        args.body.payload.multipart,
      );
      return { type: "blob.generate-client-token", clientToken: "vercel_blob_client_ok" };
    },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/inbox/media-upload", () => {
  it("logs a missing blob token and tells the composer, without calling Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const res = await tokenRequest();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: INBOX_MEDIA_MISSING_BLOB_TOKEN_MESSAGE });
    expect(mocks.handleUpload).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("check=missing BLOB_READ_WRITE_TOKEN"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("message=BLOB_READ_WRITE_TOKEN is not set"),
    );
  });

  it("logs auth, path, and conversation failures with the real message", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const auth = await tokenRequest();
    expect(auth.status).toBe(400);
    expect(await auth.json()).toEqual({ error: "Nicht angemeldet." });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("check=auth message=Nicht angemeldet."),
    );

    mocks.getAuthContext.mockResolvedValue({
      userId: "usr_1",
      workspaceId: "ws_kottke",
      workspaceRole: "admin",
      permissions: {},
      authMethod: "session",
    });
    const path = await tokenRequest("not-inbox/nope/file.pdf");
    expect(path.status).toBe(400);
    expect(await path.json()).toEqual({ error: "Ungültiger Upload-Pfad." });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("check=path message=Ungültiger Upload-Pfad."),
    );

    mocks.limit.mockResolvedValue([]);
    const missing = await tokenRequest();
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Unterhaltung nicht gefunden." });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("check=conversation message=Unterhaltung nicht gefunden."),
    );
  });

  it("does not log the read-write token when Blob throws it back", async () => {
    const secret = "vercel_blob_rw_store_SUPERSECRET";
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", secret);
    mocks.handleUpload.mockRejectedValue(
      new Error(`Invalid \`BLOB_READ_WRITE_TOKEN\` leaked ${secret}`),
    );
    const res = await tokenRequest();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("ungültig");
    expect(JSON.stringify(body)).not.toContain("SUPERSECRET");
    const logged = vi.mocked(console.error).mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("check=missing BLOB_READ_WRITE_TOKEN");
    expect(logged).not.toContain("SUPERSECRET");
    expect(logged).toContain("[redacted]");
  });
});
