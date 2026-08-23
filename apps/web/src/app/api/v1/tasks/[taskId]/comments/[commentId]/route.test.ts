import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// M5: deleteTaskComment scoped its lookup by workspaceId + userId +
// commentId only, ignoring [taskId] entirely, so
// `DELETE /tasks/<A>/comments/<comment-of-B>` deleted task B's comment as
// long as the caller authored it. Same class of bug as F6 (phases/
// milestones/risks/budget, fixed in 9632da8) and the project-document
// delete (688fb1e). This asserts the ROUTE'S HALF of the fix: the path's
// [taskId] is now actually forwarded to the service, and a mismatched pair
// reads as a plain 404 (indistinguishable from "comment not found"), not a
// silent cross-task delete. Same mocking technique as
// projects/[projectId]/documents/[documentId]/route.test.ts.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  deleteTaskComment: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/task-comments", () => ({
  deleteTaskComment: mocks.deleteTaskComment,
}));

import { DELETE } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const USER_ID = "usr_1";
const AUTH_CTX = {
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callDelete(taskId: string, commentId: string) {
  return DELETE(
    new NextRequest(`https://crm.test/api/v1/tasks/${taskId}/comments/${commentId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ taskId, commentId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("DELETE /api/v1/tasks/[taskId]/comments/[commentId]", () => {
  it("forwards the path's taskId to deleteTaskComment as its own argument", async () => {
    mocks.deleteTaskComment.mockResolvedValue(true);

    await callDelete("task_B", "comment_of_B");

    expect(mocks.deleteTaskComment).toHaveBeenCalledWith({
      taskId: "task_B",
      commentId: "comment_of_B",
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });
  });

  it("404s (never deletes) when taskId and commentId belong to different tasks", async () => {
    // The service enforces
    // and(eq(id, commentId), eq(taskId), eq(workspaceId), eq(userId)); a
    // mismatched pair means no row matches, so it returns false.
    mocks.deleteTaskComment.mockResolvedValue(false);

    const res = await callDelete("task_A", "comment_of_B");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("Comment not found or not yours");
  });

  it("deletes and returns success when the pair matches and the caller is the author", async () => {
    mocks.deleteTaskComment.mockResolvedValue(true);

    const res = await callDelete("task_A", "comment_of_A");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
  });
});
