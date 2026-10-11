import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// „Ablehnen“ unter Benutzer-Freigaben rief revokeUserAccess ohne die Regel
// „letzter Admin“ auf: Ein App-Admin, der im Team nur Mitglied ist, konnte so
// den einzigen Admin des Workspace aussperren. Jetzt läuft alles über
// rejectUser, das die Regel in derselben Transaktion prüft (siehe
// services/workspace.test.ts); die Route zeigt die Ablehnung als 409 mit
// deutschem Text. Gleiche Technik wie die anderen Route-Tests: nur die
// Service-Naht und die App-Admin-Prüfung mocken, die echten Antwort-Helfer
// und die echte Fehlerklasse behalten.
const mocks = vi.hoisted(() => ({
  getAppAdminFromRequest: vi.fn(),
  rejectUser: vi.fn(),
}));

vi.mock("@/lib/require-app-admin", () => ({
  getAppAdminFromRequest: mocks.getAppAdminFromRequest,
}));

vi.mock("@/services/workspace", async (importOriginal) => {
  const { LetzterAdminError } = await importOriginal<typeof import("@/services/workspace")>();
  return { LetzterAdminError, rejectUser: mocks.rejectUser };
});

import { LetzterAdminError } from "@/services/workspace";
import { POST } from "./route";

function callPost(userId = "usr_jonas") {
  return POST(
    new NextRequest(`https://crm.test/api/v1/admin/users/${userId}/reject`, {
      method: "POST",
    }),
    { params: Promise.resolve({ userId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppAdminFromRequest.mockResolvedValue({ userId: "usr_dario", user: {} });
});

describe("POST /api/v1/admin/users/[userId]/reject", () => {
  it("sperrt das Konto über rejectUser", async () => {
    mocks.rejectUser.mockResolvedValue({ id: "usr_jonas", approvalStatus: "rejected" });

    const res = await callPost();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: "usr_jonas", approvalStatus: "rejected" });
    expect(mocks.rejectUser).toHaveBeenCalledWith("usr_jonas");
  });

  it.each([
    "Der letzte Admin kann nicht abgelehnt werden.",
    "Der letzte Admin für Benutzer-Freigaben kann nicht abgelehnt werden.",
  ])("zeigt „%s“ als 409 mit deutschem Text", async (text) => {
    mocks.rejectUser.mockRejectedValue(new LetzterAdminError(text));

    const res = await callPost();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toEqual({ code: "CONFLICT", message: text });
  });

  it("lässt andere Fehler durch, statt sie als Ablehnung zu zeigen", async () => {
    mocks.rejectUser.mockRejectedValue(new Error("Verbindung verloren"));

    await expect(callPost()).rejects.toThrow("Verbindung verloren");
  });

  it("antwortet 404, wenn es das Konto nicht gibt", async () => {
    mocks.rejectUser.mockResolvedValue(null);

    const res = await callPost("usr_fremd");

    expect(res.status).toBe(404);
  });

  it("verweigert das Ablehnen des eigenen Kontos, ohne rejectUser aufzurufen", async () => {
    const res = await callPost("usr_dario");

    expect(res.status).toBe(400);
    expect(mocks.rejectUser).not.toHaveBeenCalled();
  });

  it("bleibt App-Admins vorbehalten", async () => {
    mocks.getAppAdminFromRequest.mockResolvedValue(null);

    const res = await callPost();

    expect(res.status).toBe(403);
    expect(mocks.rejectUser).not.toHaveBeenCalled();
  });
});
