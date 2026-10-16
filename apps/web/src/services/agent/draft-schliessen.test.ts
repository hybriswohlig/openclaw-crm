import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[],
  updateReturns: [] as unknown[],
  sets: [] as Record<string, unknown>[],
  updates: 0,
}));

function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const method of ["from", "where", "limit"]) q[method] = self;
  q.set = (value: Record<string, unknown>) => {
    mocks.sets.push(value);
    return q;
  };
  q.returning = () => Promise.resolve(result);
  q.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, err);
  return q;
}

vi.mock("@/db", () => ({
  db: {
    select: () => chain(mocks.selects.shift() ?? []),
    update: () => {
      mocks.updates += 1;
      return chain(mocks.updateReturns.shift() ?? []);
    },
  },
}));

import { closeDraftWithoutSending, supersedePendingDrafts } from "./draft-schliessen";

beforeEach(() => {
  mocks.selects = [];
  mocks.updateReturns = [];
  mocks.sets = [];
  mocks.updates = 0;
});

describe("closeDraftWithoutSending", () => {
  it("marks a pending draft superseded without sending", async () => {
    mocks.selects = [[{ status: "pending" }]];
    mocks.updateReturns = [[{ id: "draft-1" }]];

    const result = await closeDraftWithoutSending({
      workspaceId: "ws",
      draftId: "draft-1",
      userId: "user-1",
      action: "mark_sent_manually",
    });

    expect(result).toEqual({ updated: true, status: "superseded" });
    expect(mocks.sets[0]?.status).toBe("superseded");
  });

  it("dismisses a pending draft and is idempotent when it is already closed", async () => {
    mocks.selects = [[{ status: "pending" }]];
    mocks.updateReturns = [[{ id: "draft-1" }]];
    const dismissed = await closeDraftWithoutSending({
      workspaceId: "ws",
      draftId: "draft-1",
      userId: null,
      action: "dismiss",
    });
    expect(dismissed).toEqual({ updated: true, status: "dismissed" });

    mocks.selects = [[{ status: "cancelled" }]];
    const again = await closeDraftWithoutSending({
      workspaceId: "ws",
      draftId: "draft-1",
      userId: null,
      action: "mark_taken",
    });
    expect(again).toEqual({ updated: true, status: "cancelled", idempotent: true });
    expect(mocks.updates).toBe(1);
  });

  it("returns updated false when the draft does not exist", async () => {
    mocks.selects = [[]];
    const result = await closeDraftWithoutSending({
      workspaceId: "ws",
      draftId: "missing",
      userId: null,
      action: "dismiss",
    });
    expect(result).toEqual({ updated: false });
    expect(mocks.updates).toBe(0);
  });
});

describe("supersedePendingDrafts", () => {
  it("closes pending drafts for a conversation or a deal", async () => {
    mocks.updateReturns = [[{ id: "a" }, { id: "b" }]];
    const count = await supersedePendingDrafts({
      workspaceId: "ws",
      conversationId: "conv-1",
      dealRecordId: "deal-1",
      userId: "user-1",
      supersededBy: "manual_send",
    });
    expect(count).toBe(2);
    expect(mocks.sets[0]?.status).toBe("superseded");
  });

  it("does nothing when neither conversation nor deal is given", async () => {
    const count = await supersedePendingDrafts({ workspaceId: "ws" });
    expect(count).toBe(0);
    expect(mocks.updates).toBe(0);
  });
});
