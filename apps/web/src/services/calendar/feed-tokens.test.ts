import { describe, expect, it } from "vitest";
import {
  createFeedTokenService,
  generateFeedToken,
  normalizeFeedTokenParam,
  type FeedTokenRecord,
  type FeedTokenStore,
} from "./feed-tokens";

function memoryStore(): FeedTokenStore & { rows: FeedTokenRecord[] } {
  const rows: FeedTokenRecord[] = [];
  return {
    rows,
    async findByToken(token) {
      return rows.find((row) => row.token === token) ?? null;
    },
    async findActiveForUser(workspaceId, userId) {
      return (
        rows.find(
          (row) => row.workspaceId === workspaceId && row.userId === userId && !row.revokedAt
        ) ?? null
      );
    },
    async insert(input) {
      const row: FeedTokenRecord = {
        id: `id-${rows.length + 1}`,
        workspaceId: input.workspaceId,
        userId: input.userId,
        token: input.token,
        revokedAt: null,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async revoke(id, at) {
      const row = rows.find((item) => item.id === id);
      if (row) row.revokedAt = at;
    },
    async touch() {},
  };
}

describe("calendar feed tokens", () => {
  it("accepts a subscription token and rejects a revoked or unknown one", async () => {
    const store = memoryStore();
    const service = createFeedTokenService(store);
    const created = await service.getOrCreate("ws-1", "user-1");

    expect(created.token.startsWith("cal_")).toBe(true);
    expect(await service.authenticate(created.token)).toMatchObject({
      workspaceId: "ws-1",
      userId: "user-1",
    });
    expect(await service.authenticate(`${created.token}.ics`)).toMatchObject({
      workspaceId: "ws-1",
    });
    expect(await service.authenticate("cal_not-a-real-token-value")).toBeNull();

    await service.revokeActive("ws-1", "user-1");
    expect(await service.authenticate(created.token)).toBeNull();
    expect(store.rows[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("regenerates a link and leaves the previous token revoked", async () => {
    const service = createFeedTokenService(memoryStore());
    const first = await service.getOrCreate("ws-1", "user-1");
    const again = await service.getOrCreate("ws-1", "user-1");
    expect(again.token).toBe(first.token);

    const next = await service.regenerate("ws-1", "user-1");
    expect(next.token).not.toBe(first.token);
    expect(await service.authenticate(first.token)).toBeNull();
    expect(await service.authenticate(next.token)).toMatchObject({ userId: "user-1" });
  });

  it("normalises the .ics suffix and rejects malformed tokens", () => {
    const token = generateFeedToken();
    expect(normalizeFeedTokenParam(`${token}.ics`)).toBe(token);
    expect(normalizeFeedTokenParam("../secret")).toBeNull();
    expect(normalizeFeedTokenParam("")).toBeNull();
    expect(normalizeFeedTokenParam("cal_short")).toBeNull();
  });
});
