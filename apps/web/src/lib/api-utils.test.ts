import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Nach „Wieder freigeben“ (approveUser) kommt ein CRM-Konto über
// getAuthContext wieder ins Team: Ist es freigegeben und kein Konto fürs
// Mitarbeiterportal, legt ensureUserWorkspaceAccess die beim Entfernen
// gelöschte Mitgliedschaft neu an. Gesperrte Konten und Mitarbeiterkonten
// bekommen keinen Kontext und keine Mitgliedschaft.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  konto: vi.fn(),
  ensureUserWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.konto() }) }),
    }),
  },
}));

vi.mock("@/services/workspace", () => ({
  ensureUserWorkspaceAccess: mocks.ensureUserWorkspaceAccess,
  getSingletonWorkspaceId: vi.fn(),
}));

import { getAuthContext } from "./api-utils";

function anfrage() {
  return new NextRequest("https://crm.test/api/v1/workspace");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "usr_jonas" } });
});

describe("getAuthContext", () => {
  it("bringt ein wieder freigegebenes CRM-Konto über ensureUserWorkspaceAccess zurück ins Team", async () => {
    mocks.konto.mockReturnValue([{ approvalStatus: "approved", isAppAdmin: false, role: "staff" }]);
    mocks.ensureUserWorkspaceAccess.mockResolvedValue({
      workspaceId: "ws_kottke",
      role: "member",
      permissions: {},
    });

    await expect(getAuthContext(anfrage())).resolves.toEqual({
      userId: "usr_jonas",
      workspaceId: "ws_kottke",
      workspaceRole: "member",
      permissions: {},
      authMethod: "cookie",
    });
    expect(mocks.ensureUserWorkspaceAccess).toHaveBeenCalledWith("usr_jonas", false);
  });

  it.each([
    ["gesperrt", { approvalStatus: "rejected", isAppAdmin: false, role: "staff" }],
    ["noch nicht freigegeben", { approvalStatus: "pending", isAppAdmin: false, role: "staff" }],
    ["Mitarbeiterportal", { approvalStatus: "approved", isAppAdmin: false, role: "employee" }],
  ])("lässt ein Konto (%s) nicht herein und legt keine Mitgliedschaft an", async (_fall, zeile) => {
    mocks.konto.mockReturnValue([zeile]);

    await expect(getAuthContext(anfrage())).resolves.toBeNull();
    expect(mocks.ensureUserWorkspaceAccess).not.toHaveBeenCalled();
  });
});
