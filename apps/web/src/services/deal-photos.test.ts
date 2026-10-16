import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTWORT_STATUS, zaehltAlsAntwort } from "@/services/lagekarte/wartet";
import { contentSha256Hex, prepareDealPhotoUploads } from "@/lib/deal-photo-upload";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
  transaction: vi.fn(),
}));

function query(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: () => query(mocks.selects.shift() ?? []),
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: () => ({
          values: (values: Record<string, unknown>) => ({
            returning: () => {
              mocks.inserts.push(values);
              return Promise.resolve([
                {
                  id: values.externalMessageId ? "msg-1" : `att-${mocks.inserts.length}`,
                  fileName: values.fileName,
                  mimeType: values.mimeType,
                  fileSize: values.fileSize,
                  createdAt: new Date("2026-10-16T08:00:00.000Z"),
                },
              ]);
            },
          }),
        }),
      }),
  },
}));

import { INTERNAL_PHOTO_MESSAGE_STATUS, uploadInternalDealPhotos } from "./deal-photos";

function jpeg(): Buffer {
  const buf = Buffer.alloc(16, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function prepared(bytes: Buffer = jpeg(), filename = "kueche.jpg") {
  const result = prepareDealPhotoUploads({
    filename,
    contentType: "image/jpeg",
    dataBase64: bytes.toString("base64"),
  });
  if (!result.ok) throw new Error(result.error);
  return result.photos;
}

beforeEach(() => {
  mocks.selects.length = 0;
  mocks.inserts.length = 0;
});

describe("uploadInternalDealPhotos", () => {
  it("does not count as a sent reply", () => {
    expect(ANTWORT_STATUS).not.toContain(INTERNAL_PHOTO_MESSAGE_STATUS);
    expect(
      zaehltAlsAntwort({ direction: "outbound", status: INTERNAL_PHOTO_MESSAGE_STATUS })
    ).toBe(false);
  });

  it("stores an internal photo on the deal when there is no conversation", async () => {
    mocks.selects.push([{ id: "deal-1" }], [], []);
    const photos = prepared();

    const result = await uploadInternalDealPhotos({
      workspaceId: "ws-1",
      dealRecordId: "deal-1",
      photos,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
    expect(result.photos).toEqual([
      expect.objectContaining({
        fileName: "kueche.jpg",
        mimeType: "image/jpeg",
        source: "internal",
        customerVisible: false,
        skipped: false,
        contentSha256: photos[0]!.contentSha256,
      }),
    ]);
    expect(mocks.inserts).toEqual([
      expect.objectContaining({
        workspaceId: "ws-1",
        dealRecordId: "deal-1",
        fileName: "kueche.jpg",
        mimeType: "image/jpeg",
        fileContent: photos[0]!.fileContent,
        contentSha256: photos[0]!.contentSha256,
      }),
    ]);
    expect(mocks.inserts[0]).not.toHaveProperty("conversationId");
    expect(mocks.inserts[0]).not.toHaveProperty("messageId");
  });

  it("skips a photo whose bytes are already on the deal", async () => {
    const photos = prepared();
    mocks.selects.push(
      [{ id: "deal-1" }],
      [
        {
          id: "existing-1",
          fileContent: photos[0]!.fileContent,
          externalMediaId: null,
        },
      ],
      []
    );

    const result = await uploadInternalDealPhotos({
      workspaceId: "ws-1",
      dealRecordId: "deal-1",
      photos,
    });

    expect(result).toEqual({
      ok: true,
      photos: [],
      skipped: [
        {
          fileName: "kueche.jpg",
          contentSha256: photos[0]!.contentSha256,
          duplicateOf: "existing-1",
          skipped: true,
          reason: "duplicate",
        },
      ],
    });
    expect(mocks.inserts).toEqual([]);
  });

  it("skips a photo that matches a stored content hash", async () => {
    const bytes = jpeg();
    const hash = contentSha256Hex(bytes);
    mocks.selects.push(
      [{ id: "deal-1" }],
      [{ id: "existing-2", fileContent: "", externalMediaId: `sha256:${hash}` }],
      []
    );

    const result = await uploadInternalDealPhotos({
      workspaceId: "ws-1",
      dealRecordId: "deal-1",
      photos: prepared(bytes),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped[0]?.duplicateOf).toBe("existing-2");
    expect(mocks.inserts).toEqual([]);
  });

  it("skips a photo that matches a hash already stored on the deal", async () => {
    const bytes = jpeg();
    const hash = contentSha256Hex(bytes);
    mocks.selects.push([{ id: "deal-1" }], [], [{ id: "deal-photo-1", contentSha256: hash }]);

    const result = await uploadInternalDealPhotos({
      workspaceId: "ws-1",
      dealRecordId: "deal-1",
      photos: prepared(bytes),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped[0]?.duplicateOf).toBe("deal-photo-1");
    expect(mocks.inserts).toEqual([]);
  });

  it("skips a second copy of the same photo in one request", async () => {
    mocks.selects.push([{ id: "deal-1" }], [], []);
    const photos = [...prepared(), ...prepared()];

    const result = await uploadInternalDealPhotos({
      workspaceId: "ws-1",
      dealRecordId: "deal-1",
      photos,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.photos).toHaveLength(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        duplicateOf: result.photos[0]!.id,
        reason: "duplicate",
      }),
    ]);
    expect(mocks.inserts.filter((row) => row.fileName)).toHaveLength(1);
  });

  it("refuses to store when the deal is not in the workspace", async () => {
    mocks.selects.push([]);
    const result = await uploadInternalDealPhotos({
      workspaceId: "ws-1",
      dealRecordId: "deal-1",
      photos: prepared(),
    });
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(mocks.inserts).toEqual([]);
  });
});
