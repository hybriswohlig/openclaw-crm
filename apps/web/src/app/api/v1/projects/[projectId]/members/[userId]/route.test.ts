import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// F5: updateProjectMemberRole used to collapse "invalid role" and "member
// not found" into the same `return null`, which the route rendered as a
// single 404 "Mitglied nicht gefunden oder Rolle ungültig" — indistinguishable
// from an actually-missing member. addProjectMember (POST, same resource)
// already throws 400 for an invalid role; this asserts PATCH now matches it:
// invalid role -> 400 with the German message, not-found -> 404.
//
// Same technique as inbox/attachments/[id]/route.test.ts: mock the service
// seam (@/services/project-members), keep the real getAuthContext/notFound/
// badRequest/success from @/lib/api-utils via importOriginal.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  updateProjectMemberRole: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/project-members", () => ({
  updateProjectMemberRole: mocks.updateProjectMemberRole,
  removeProjectMember: vi.fn(),
}));

import { PATCH } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";

const AUTH_CTX = {
  userId: "usr_actor",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

function callPatch(body: unknown, projectId = "proj_1", userId = "usr_subject") {
  return PATCH(
    new NextRequest(`https://crm.test/api/v1/projects/${projectId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId, userId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("PATCH /api/v1/projects/[projectId]/members/[userId]", () => {
  it("returns 400 with the German message when the service rejects an invalid role", async () => {
    mocks.updateProjectMemberRole.mockRejectedValue(new Error("Ungültige Projektrolle."));

    const res = await callPatch({ role: "leader" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("Ungültige Projektrolle.");
  });

  it("returns 404 (not 400) when the service returns null — a genuine not-found", async () => {
    mocks.updateProjectMemberRole.mockResolvedValue(null);

    const res = await callPatch({ role: "mitglied" });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("Mitglied nicht gefunden");
  });

  it("returns 200 with the updated member on success", async () => {
    mocks.updateProjectMemberRole.mockResolvedValue({
      userId: "usr_subject",
      role: "leiter",
      name: "Nuri",
      email: "nuri@kottke.de",
      image: null,
    });

    const res = await callPatch({ role: "leiter" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.role).toBe("leiter");
  });

  it("returns 400 before ever calling the service when role is missing", async () => {
    const res = await callPatch({});
    expect(res.status).toBe(400);
    expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
  });
});
