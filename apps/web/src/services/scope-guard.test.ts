import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendPush: vi.fn(),
  emitEvent: vi.fn(),
  createNotification: vi.fn(),
  listMembers: vi.fn(),
  createTask: vi.fn(),
  hintergrund: [] as Promise<unknown>[],
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./records", () => ({ getRecord: vi.fn(), updateRecord: vi.fn() }));
vi.mock("./quotations", () => ({ getQuotation: vi.fn() }));
vi.mock("./activity-events", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("./notifications", () => ({ createNotification: mocks.createNotification }));
vi.mock("./workspace", () => ({ listMembers: mocks.listMembers }));
vi.mock("./push", () => ({ sendPush: mocks.sendPush }));
vi.mock("./tasks", () => ({ createTask: mocks.createTask }));
vi.mock("./kva-annahme", () => ({ aktivBedingung: vi.fn() }));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    mocks.hintergrund.push(p);
  },
}));

import { dispatchScopeWarning } from "./scope-guard";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hintergrund.length = 0;
  mocks.sendPush.mockResolvedValue(undefined);
  mocks.emitEvent.mockResolvedValue(undefined);
  mocks.createNotification.mockResolvedValue(undefined);
  mocks.listMembers.mockResolvedValue([{ userId: "u1" }]);
});

describe("dispatchScopeWarning", () => {
  it("verlinkt den Deal in der Push über die Weiche", async () => {
    await dispatchScopeWarning({
      workspaceId: "ws",
      dealRecordId: "d1",
      dealName: "Familie Weber",
      tier: "link_issued",
      change: { changed: true, changedFields: ["volume_cbm"], changedLabels: ["Volumen"] },
      snapshotId: "snap_1",
      quotedTotalCents: 100,
      actorId: null,
    });
    await Promise.all(mocks.hintergrund);

    expect(mocks.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/weiter?deal=d1" }),
      { workspaceId: "ws" }
    );
  });
});
