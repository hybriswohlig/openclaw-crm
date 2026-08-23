import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Same class of bug as F6 (phases/milestones/risks/budget, fixed in
// 9632da8), found while auditing this route family and left out of that
// fix's scope: DELETE /projects/[projectId]/documents/[documentId] scoped
// the lookup by workspaceId + documentId only, ignoring [projectId]
// entirely, so `DELETE /projects/<A>/documents/<doc-of-B>` deleted project
// B's document. The fix moved the check into deleteProjectDocument
// (`and(eq(id), eq(workspaceId), eq(projectId))`), which also covers MCP
// callers that pass projectId/documentId as two independent arguments, not
// just REST callers going through this route.
//
// This asserts the ROUTE'S HALF of that fix: the path's [projectId] is now
// actually forwarded to the service, and a mismatched pair reads as a plain
// 404 (indistinguishable from "document not found"), not a silent
// cross-project delete. Same mocking technique as
// phases/[phaseId]/route.test.ts.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getProjectDocument: vi.fn(),
  deleteProjectDocument: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/project-documents", () => ({
  getProjectDocument: mocks.getProjectDocument,
  deleteProjectDocument: mocks.deleteProjectDocument,
}));

import { DELETE } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callDelete(projectId: string, documentId: string) {
  return DELETE(
    new NextRequest(`https://crm.test/api/v1/projects/${projectId}/documents/${documentId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ projectId, documentId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("DELETE /api/v1/projects/[projectId]/documents/[documentId]", () => {
  it("forwards the path's projectId to deleteProjectDocument as its own argument", async () => {
    mocks.deleteProjectDocument.mockResolvedValue(true);

    await callDelete("proj_B", "doc_of_B");

    expect(mocks.deleteProjectDocument).toHaveBeenCalledWith(WORKSPACE_ID, "doc_of_B", "proj_B");
  });

  it("404s (never deletes) when projectId and documentId belong to different projects", async () => {
    // The service enforces and(eq(id, documentId), eq(workspaceId), eq(projectId));
    // a mismatched pair means no row matches, so it returns false.
    mocks.deleteProjectDocument.mockResolvedValue(false);

    const res = await callDelete("proj_A", "doc_of_B");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("Dokument nicht gefunden");
  });
});
