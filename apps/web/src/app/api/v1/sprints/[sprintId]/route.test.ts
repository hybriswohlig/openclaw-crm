import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// PATCH /api/v1/sprints/[sprintId] is overloaded: an action verb
// ("aktivieren"/"abschliessen"), or a plain field edit when body.action is
// absent. Before this guard, a mis-typed action ("aktiviren", "activate",
// "abschließen" with an ß) fell through silently to the plain-edit branch —
// which reads name/goal/startDate/endDate/capacityPoints, all undefined for
// a bare `{ action: "..." }` body — and blanked a live, running sprint.
// Separate MCP tools (crm_activate_sprint/crm_close_sprint) protect THOSE
// callers; this guard protects every other caller (the UI, crm_api, curl).
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  updateSprint: vi.fn(),
  activateSprint: vi.fn(),
  closeSprint: vi.fn(),
  deleteSprint: vi.fn(),
  getSprint: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/sprints", () => ({
  updateSprint: mocks.updateSprint,
  activateSprint: mocks.activateSprint,
  closeSprint: mocks.closeSprint,
  deleteSprint: mocks.deleteSprint,
  getSprint: mocks.getSprint,
}));

import { PATCH } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callPatch(sprintId: string, body: unknown) {
  return PATCH(
    new NextRequest(`https://crm.test/api/v1/sprints/${sprintId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sprintId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("PATCH /api/v1/sprints/[sprintId] — unknown action guard", () => {
  it("rejects a mis-typed action with 400 instead of falling through to a blank edit", async () => {
    const res = await callPatch("s-3", { action: "aktiviren" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toContain("Unbekannte Aktion");
    expect(mocks.updateSprint).not.toHaveBeenCalled();
    expect(mocks.activateSprint).not.toHaveBeenCalled();
  });

  it("still dispatches the aktivieren action", async () => {
    mocks.activateSprint.mockResolvedValue({ sprint: { id: "s-3", state: "aktiv" } });

    const res = await callPatch("s-3", { action: "aktivieren" });

    expect(res.status).toBe(200);
    expect(mocks.activateSprint).toHaveBeenCalledWith(WORKSPACE_ID, "s-3");
    expect(mocks.updateSprint).not.toHaveBeenCalled();
  });

  it("still dispatches the abschliessen action", async () => {
    mocks.closeSprint.mockResolvedValue({
      sprint: { id: "s-3", state: "abgeschlossen" },
      summary: { totalTasks: 5, doneTasks: 3, carriedTasks: 2 },
    });

    const res = await callPatch("s-3", { action: "abschliessen" });

    expect(res.status).toBe(200);
    expect(mocks.closeSprint).toHaveBeenCalledWith(WORKSPACE_ID, "s-3");
  });

  it("still allows a plain edit with no action key", async () => {
    mocks.updateSprint.mockResolvedValue({ id: "s-3", name: "Sprint 4" });

    const res = await callPatch("s-3", { name: "Sprint 4" });

    expect(res.status).toBe(200);
    expect(mocks.updateSprint).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "s-3",
      expect.objectContaining({ name: "Sprint 4" }),
    );
  });
});
