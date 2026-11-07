import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendPush: vi.fn(),
  batchGetRecordDisplayNames: vi.fn(),
  limit: vi.fn(),
  zeilen: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve(mocks.zeilen()), { limit: mocks.limit }),
      }),
    }),
  },
}));

vi.mock("./push", () => ({ sendPush: mocks.sendPush }));
vi.mock("./display-names", () => ({
  batchGetRecordDisplayNames: mocks.batchGetRecordDisplayNames,
}));

import { notifyTaskAssigned } from "./task-notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendPush.mockResolvedValue(undefined);
  mocks.limit.mockResolvedValue([{ name: "Jonas Meyer" }]);
});

describe("notifyTaskAssigned", () => {
  it("verlinkt einen Deal über die Weiche", async () => {
    mocks.zeilen.mockReturnValue([{ recordId: "deal_1" }]);
    mocks.batchGetRecordDisplayNames.mockResolvedValue(
      new Map([["deal_1", { displayName: "Familie Weber", objectSlug: "deals", objectName: "Deals" }]])
    );

    await notifyTaskAssigned({
      workspaceId: "ws",
      taskId: "t1",
      taskContent: "Anrufen",
      actorUserId: "actor",
      newAssigneeIds: ["user2"],
    });

    expect(mocks.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/weiter?deal=deal_1" }),
      { workspaceId: "ws", userIds: ["user2"] }
    );
  });

  it("lässt den Personen-Fallback auf der alten Seite", async () => {
    mocks.zeilen.mockReturnValue([{ recordId: "p1" }]);
    mocks.batchGetRecordDisplayNames.mockResolvedValue(
      new Map([["p1", { displayName: "Anna", objectSlug: "people", objectName: "Personen" }]])
    );

    await notifyTaskAssigned({
      workspaceId: "ws",
      taskId: "t1",
      taskContent: "Anrufen",
      actorUserId: "actor",
      newAssigneeIds: ["user2"],
    });

    expect(mocks.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/objects/people/p1" }),
      { workspaceId: "ws", userIds: ["user2"] }
    );
  });
});
