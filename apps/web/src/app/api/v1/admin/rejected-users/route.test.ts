import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Liste für den Bereich „Gesperrt“ unter Benutzer-Freigaben. Wer sie sieht,
// kann Konten wieder freigeben, also nur App-Admins. Gleiche Technik wie die
// anderen Route-Tests: nur die Service-Naht und die App-Admin-Prüfung mocken.
const mocks = vi.hoisted(() => ({
  getAppAdminFromRequest: vi.fn(),
  listRejectedUsers: vi.fn(),
}));

vi.mock("@/lib/require-app-admin", () => ({
  getAppAdminFromRequest: mocks.getAppAdminFromRequest,
}));

vi.mock("@/services/workspace", () => ({
  listRejectedUsers: mocks.listRejectedUsers,
}));

import { GET } from "./route";

function callGet() {
  return GET(new NextRequest("https://crm.test/api/v1/admin/rejected-users"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppAdminFromRequest.mockResolvedValue({ userId: "usr_dario", user: {} });
});

describe("GET /api/v1/admin/rejected-users", () => {
  it("liefert die gesperrten Konten", async () => {
    const gesperrt = [{ id: "usr_jonas", name: "Jonas", email: "jonas@kottke-umzuege.de" }];
    mocks.listRejectedUsers.mockResolvedValue(gesperrt);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(gesperrt);
  });

  it("bleibt App-Admins vorbehalten", async () => {
    mocks.getAppAdminFromRequest.mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(mocks.listRejectedUsers).not.toHaveBeenCalled();
  });
});
