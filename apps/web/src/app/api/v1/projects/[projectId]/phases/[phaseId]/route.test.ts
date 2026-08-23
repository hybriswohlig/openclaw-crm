import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// F6: PATCH/DELETE /projects/[projectId]/phases/[phaseId] used to scope the
// lookup by workspaceId + phaseId only, ignoring [projectId] entirely — so
// `PATCH /projects/<A>/phases/<phase-of-B>` succeeded, renamed B's phase,
// and filed the activity row under B. The fix moved the check into
// updatePhase/deletePhase (`and(eq(id), eq(workspaceId), eq(projectId))`),
// which also covers MCP callers that pass projectId/phaseId as two
// independent arguments — not just REST callers going through this route.
//
// This asserts the ROUTE'S HALF of that fix: the path's [projectId] is now
// actually forwarded to the service, and a mismatched pair reads as a plain
// 404 (indistinguishable from "phase not found"), not a silent cross-project
// write. Same mocking technique as inbox/attachments/[id]/route.test.ts.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  updatePhase: vi.fn(),
  deletePhase: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/project-phases", () => ({
  updatePhase: mocks.updatePhase,
  deletePhase: mocks.deletePhase,
}));

import { PATCH, DELETE } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callPatch(projectId: string, phaseId: string, body: unknown) {
  return PATCH(
    new NextRequest(`https://crm.test/api/v1/projects/${projectId}/phases/${phaseId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId, phaseId }) },
  );
}

function callDelete(projectId: string, phaseId: string) {
  return DELETE(
    new NextRequest(`https://crm.test/api/v1/projects/${projectId}/phases/${phaseId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ projectId, phaseId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("PATCH /api/v1/projects/[projectId]/phases/[phaseId]", () => {
  it("forwards the path's projectId to updatePhase as its own argument", async () => {
    mocks.updatePhase.mockResolvedValue({ id: "phase_of_B", projectId: "proj_B", name: "X" });

    await callPatch("proj_B", "phase_of_B", { name: "Neuer Name" });

    expect(mocks.updatePhase).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      "phase_of_B",
      { name: "Neuer Name" },
      "proj_B",
    );
  });

  it("404s (never edits) when projectId and phaseId belong to different projects", async () => {
    // The service enforces and(eq(id, phaseId), eq(workspaceId), eq(projectId));
    // a mismatched pair means no row matches, so it returns null.
    mocks.updatePhase.mockResolvedValue(null);

    const res = await callPatch("proj_A", "phase_of_B", { name: "Umbenannt" });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("Phase nicht gefunden");
  });
});

describe("DELETE /api/v1/projects/[projectId]/phases/[phaseId]", () => {
  it("forwards the path's projectId to deletePhase as its own argument", async () => {
    mocks.deletePhase.mockResolvedValue(true);

    await callDelete("proj_B", "phase_of_B");

    expect(mocks.deletePhase).toHaveBeenCalledWith(WORKSPACE_ID, "phase_of_B", "proj_B");
  });

  it("404s (never deletes) when projectId and phaseId belong to different projects", async () => {
    mocks.deletePhase.mockResolvedValue(false);

    const res = await callDelete("proj_A", "phase_of_B");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("Phase nicht gefunden");
  });
});
