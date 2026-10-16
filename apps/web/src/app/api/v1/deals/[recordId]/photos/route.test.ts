import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  uploadInternalDealPhotos: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/deal-photos")>();
  return { ...actual, uploadInternalDealPhotos: mocks.uploadInternalDealPhotos };
});

import { POST } from "./route";

const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: "ws_kottke_prod",
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function jpeg(): string {
  const buf = Buffer.alloc(16, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf.toString("base64");
}

function call(body: unknown, authorization = "Bearer oc_sk_test") {
  return POST(
    new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/photos`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: DEAL_ID }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.uploadInternalDealPhotos.mockResolvedValue({
    ok: true,
    photos: [
      {
        id: "att-1",
        fileName: "kueche.jpg",
        mimeType: "image/jpeg",
        fileSize: 16,
        contentSha256: "abc",
        createdAt: "2026-10-16T08:00:00.000Z",
        source: "internal",
        customerVisible: false,
        skipped: false,
      },
    ],
    skipped: [],
  });
});

describe("POST /api/v1/deals/[recordId]/photos", () => {
  it("authenticates Bearer oc_sk through getAuthContext", async () => {
    const res = await call({
      filename: "kueche.jpg",
      contentType: "image/jpeg",
      dataBase64: jpeg(),
    });

    expect(res.status).toBe(200);
    expect(mocks.getAuthContext).toHaveBeenCalledTimes(1);
    const req = mocks.getAuthContext.mock.calls[0]![0] as NextRequest;
    expect(req.headers.get("authorization")).toBe("Bearer oc_sk_test");
    expect(mocks.uploadInternalDealPhotos).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: AUTH_CTX.workspaceId,
        dealRecordId: DEAL_ID,
      })
    );
    const body = await res.json();
    expect(body.data.photos[0].customerVisible).toBe(false);
    expect(body.data.photos[0].source).toBe("internal");
  });

  it("rejects a missing or unknown oc_sk key", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await call(
      { filename: "kueche.jpg", contentType: "image/jpeg", dataBase64: jpeg() },
      "Bearer oc_sk_unknown"
    );
    expect(res.status).toBe(401);
    expect(mocks.uploadInternalDealPhotos).not.toHaveBeenCalled();
  });

  it("rejects a non-image and stores nothing", async () => {
    const res = await call({
      filename: "rechnung.jpg",
      contentType: "image/jpeg",
      dataBase64: Buffer.from("%PDF-1.4").toString("base64"),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_AN_IMAGE");
    expect(mocks.uploadInternalDealPhotos).not.toHaveBeenCalled();
  });

  it("returns skipped duplicates without treating them as an error", async () => {
    mocks.uploadInternalDealPhotos.mockResolvedValue({
      ok: true,
      photos: [],
      skipped: [
        {
          fileName: "kueche.jpg",
          contentSha256: "abc",
          duplicateOf: "att-old",
          skipped: true,
          reason: "duplicate",
        },
      ],
    });
    const res = await call({
      filename: "kueche.jpg",
      contentType: "image/jpeg",
      dataBase64: jpeg(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.photos).toEqual([]);
    expect(body.data.skipped[0].duplicateOf).toBe("att-old");
  });
});
