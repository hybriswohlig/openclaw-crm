import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// DELETE muss den Aufrufer an removeMember weitergeben, sonst greift die
// Sperre „sich selbst entfernen“ nicht. PATCH muss die Ablehnung „letzter
// Admin“ aus updateMemberRole als 400 zeigen statt als Serverfehler. Gleiche
// Technik wie die anderen Route-Tests: nur die Service-Naht mocken, die
// echten Antwort-Helfer aus @/lib/api-utils behalten.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  updateMemberPermissions: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/workspace", () => ({
  removeMember: mocks.removeMember,
  updateMemberRole: mocks.updateMemberRole,
  updateMemberPermissions: mocks.updateMemberPermissions,
}));

import { DELETE, PATCH } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";

const AUTH_CTX = {
  userId: "usr_dario",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function callDelete(memberId = "mem_jonas") {
  return DELETE(
    new NextRequest(`https://crm.test/api/v1/workspace-members/${memberId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ memberId }) }
  );
}

function callPatch(body: unknown, memberId = "mem_jonas") {
  return PATCH(
    new NextRequest(`https://crm.test/api/v1/workspace-members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ memberId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("DELETE /api/v1/workspace-members/[memberId]", () => {
  it("gibt Workspace, Mitglied und den Aufrufer an removeMember weiter", async () => {
    mocks.removeMember.mockResolvedValue({ id: "mem_jonas", userId: "usr_jonas", role: "member" });

    const res = await callDelete();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ id: "mem_jonas", userId: "usr_jonas" });
    expect(mocks.removeMember).toHaveBeenCalledWith(WORKSPACE_ID, "mem_jonas", "usr_dario");
  });

  it("zeigt die Ablehnung aus dem Service als 400 mit deutschem Text", async () => {
    mocks.removeMember.mockRejectedValue(new Error("Du kannst dich nicht selbst entfernen."));

    const res = await callDelete("mem_dario");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("Du kannst dich nicht selbst entfernen.");
  });

  it("antwortet 404, wenn es die Mitgliedschaft nicht gibt", async () => {
    mocks.removeMember.mockResolvedValue(null);

    const res = await callDelete("mem_fremd");

    expect(res.status).toBe(404);
  });

  it("lässt nur Admins entfernen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...AUTH_CTX, workspaceRole: "member" });

    const res = await callDelete();

    expect(res.status).toBe(400);
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it("antwortet 401 ohne Anmeldung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await callDelete();

    expect(res.status).toBe(401);
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/workspace-members/[memberId] (Rolle)", () => {
  it("ändert die Rolle über updateMemberRole im eigenen Workspace", async () => {
    mocks.updateMemberRole.mockResolvedValue({ id: "mem_jonas", role: "member" });

    const res = await callPatch({ role: "member" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ id: "mem_jonas", role: "member" });
    expect(mocks.updateMemberRole).toHaveBeenCalledWith(WORKSPACE_ID, "mem_jonas", "member");
  });

  it("zeigt „letzter Admin“ als 400 mit deutschem Text und ändert auch keine Berechtigungen", async () => {
    mocks.updateMemberRole.mockRejectedValue(
      new Error("Der letzte Admin kann nicht zum Mitglied gemacht werden.")
    );

    const res = await callPatch({ role: "member", permissions: { manageChannels: true } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("Der letzte Admin kann nicht zum Mitglied gemacht werden.");
    expect(mocks.updateMemberPermissions).not.toHaveBeenCalled();
  });

  it("antwortet 404, wenn es die Mitgliedschaft nicht gibt", async () => {
    mocks.updateMemberRole.mockResolvedValue(null);

    const res = await callPatch({ role: "admin" }, "mem_fremd");

    expect(res.status).toBe(404);
  });

  it("lässt nur Admins Rollen ändern und prüft die Rolle vor dem Service", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...AUTH_CTX, workspaceRole: "member" });
    expect((await callPatch({ role: "admin" })).status).toBe(400);

    mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
    expect((await callPatch({ role: "owner" })).status).toBe(400);

    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
  });
});
