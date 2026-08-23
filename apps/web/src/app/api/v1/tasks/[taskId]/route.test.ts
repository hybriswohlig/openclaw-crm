import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// C1: GET /api/v1/tasks/[taskId] did not exist — an agent had no way to
// read a single task. crm_list_tasks caps at 200 rows and hides completed
// tasks and subtasks by default, so it cannot substitute for a task it
// would filter out or that fell off the page. This asserts the route's
// half of the fix: it forwards the path's taskId (and the caller's
// workspaceId) to getTask and turns a null result into a 404, same mocking
// technique as projects/[projectId]/documents/[documentId]/route.test.ts.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/tasks")>();
  return { ...actual, getTask: mocks.getTask };
});

import { GET } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callGet(taskId: string) {
  return GET(new NextRequest(`https://crm.test/api/v1/tasks/${taskId}`), {
    params: Promise.resolve({ taskId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("GET /api/v1/tasks/[taskId]", () => {
  it("forwards the path's taskId and the caller's workspaceId to getTask", async () => {
    mocks.getTask.mockResolvedValue({ id: "t1", content: "Test" });

    await callGet("t1");

    expect(mocks.getTask).toHaveBeenCalledWith("t1", WORKSPACE_ID);
  });

  it("returns the enriched task on success", async () => {
    const task = { id: "t1", content: "Test", assignees: [], recordIds: [] };
    mocks.getTask.mockResolvedValue(task);

    const res = await callGet("t1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(task);
  });

  it("404s when the task does not exist or belongs to another workspace", async () => {
    mocks.getTask.mockResolvedValue(null);

    const res = await callGet("t-of-other-workspace");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("Task not found");
  });

  it("401s when unauthenticated and never calls getTask", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await callGet("t1");

    expect(res.status).toBe(401);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });
});
