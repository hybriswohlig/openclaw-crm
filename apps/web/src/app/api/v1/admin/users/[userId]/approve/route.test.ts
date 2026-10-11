import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// „Wieder freigeben“ unter Benutzer-Freigaben nutzt dieselbe Route wie das
// Freigeben neuer Registrierungen. Sie darf vorher nicht nach der Freigabe
// fragen, damit gesperrte Konten („rejected“) genauso durchgehen; was
// approveUser daraus macht, prüft services/workspace.test.ts. Gleiche Technik
// wie die anderen Route-Tests: nur die Service-Naht und die App-Admin-Prüfung
// mocken, die echten Antwort-Helfer behalten.
const mocks = vi.hoisted(() => ({
  getAppAdminFromRequest: vi.fn(),
  approveUser: vi.fn(),
}));

vi.mock("@/lib/require-app-admin", () => ({
  getAppAdminFromRequest: mocks.getAppAdminFromRequest,
}));

vi.mock("@/services/workspace", () => ({
  approveUser: mocks.approveUser,
}));

import { POST } from "./route";

function callPost(userId = "usr_jonas") {
  return POST(
    new NextRequest(`https://crm.test/api/v1/admin/users/${userId}/approve`, {
      method: "POST",
    }),
    { params: Promise.resolve({ userId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppAdminFromRequest.mockResolvedValue({ userId: "usr_dario", user: {} });
});

describe("POST /api/v1/admin/users/[userId]/approve", () => {
  it("gibt das Konto über approveUser frei, auch ein gesperrtes", async () => {
    mocks.approveUser.mockResolvedValue({ id: "usr_jonas", approvalStatus: "approved" });

    const res = await callPost();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: "usr_jonas", approvalStatus: "approved" });
    expect(mocks.approveUser).toHaveBeenCalledWith("usr_jonas");
  });

  it("antwortet 404, wenn es das Konto nicht gibt", async () => {
    mocks.approveUser.mockResolvedValue(null);

    const res = await callPost("usr_fremd");

    expect(res.status).toBe(404);
  });

  it("bleibt App-Admins vorbehalten", async () => {
    mocks.getAppAdminFromRequest.mockResolvedValue(null);

    const res = await callPost();

    expect(res.status).toBe(403);
    expect(mocks.approveUser).not.toHaveBeenCalled();
  });
});
