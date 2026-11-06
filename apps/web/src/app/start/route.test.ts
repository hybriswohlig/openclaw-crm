import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/user-settings", () => ({
  getUserSettings: mocks.getUserSettings,
}));

import { GET } from "./route";

const NUTZER = {
  userId: "usr_jonas",
  workspaceId: "ws_kottke",
  workspaceRole: "member" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function pfad(res: Response): string {
  const loc = res.headers.get("location");
  if (!loc) return "";
  return new URL(loc).pathname;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /start", () => {
  it("leitet ohne Sitzung auf /login und liest keine Einstellungen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await GET(new NextRequest("https://crm.test/start"));

    expect(pfad(res)).toBe("/login");
    expect(mocks.getUserSettings).not.toHaveBeenCalled();
  });

  it("leitet bei alter Oberfläche auf /home", async () => {
    mocks.getAuthContext.mockResolvedValue(NUTZER);
    mocks.getUserSettings.mockResolvedValue({ uiVersion: "alt", ansichten: {} });

    const res = await GET(new NextRequest("https://crm.test/start"));

    expect(pfad(res)).toBe("/home");
    expect(mocks.getUserSettings).toHaveBeenCalledWith("usr_jonas");
  });

  it("leitet bei neuer Oberfläche auf /app/heute", async () => {
    mocks.getAuthContext.mockResolvedValue(NUTZER);
    mocks.getUserSettings.mockResolvedValue({ uiVersion: "neu", ansichten: { plan: { modus: "woche" } } });

    const res = await GET(new NextRequest("https://crm.test/start"));

    expect(pfad(res)).toBe("/app/heute");
  });

  it("leitet bei einem Fehler beim Lesen auf /home", async () => {
    mocks.getAuthContext.mockResolvedValue(NUTZER);
    mocks.getUserSettings.mockRejectedValue(new Error("db weg"));

    const res = await GET(new NextRequest("https://crm.test/start"));

    expect(pfad(res)).toBe("/home");
  });
});
