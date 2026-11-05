import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getUserSettings: vi.fn(),
  setUiVersion: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/user-settings", () => ({
  getUserSettings: mocks.getUserSettings,
  setUiVersion: mocks.setUiVersion,
}));

import { GET, PATCH } from "./route";

const NUTZER = {
  userId: "usr_jonas",
  workspaceId: "ws_kottke",
  workspaceRole: "member" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function callPatch(body: unknown, raw = false) {
  return PATCH(
    new NextRequest("https://crm.test/api/v1/me/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(NUTZER);
  mocks.getUserSettings.mockResolvedValue({ uiVersion: "alt", ansichten: {} });
  mocks.setUiVersion.mockResolvedValue(undefined);
});

describe("GET /api/v1/me/settings", () => {
  it("liefert Oberfläche und Ansichten", async () => {
    mocks.getUserSettings.mockResolvedValue({
      uiVersion: "neu",
      ansichten: { inbox: { filter: "offen" } },
    });

    const res = await GET(new NextRequest("https://crm.test/api/v1/me/settings"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      uiVersion: "neu",
      ansichten: { inbox: { filter: "offen" } },
    });
    expect(mocks.getUserSettings).toHaveBeenCalledWith("usr_jonas");
  });

  it("antwortet 401 ohne Anmeldung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await GET(new NextRequest("https://crm.test/api/v1/me/settings"));

    expect(res.status).toBe(401);
    expect(mocks.getUserSettings).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/me/settings", () => {
  it("lehnt v3 ab und schreibt nichts", async () => {
    const res = await callPatch({ uiVersion: "v3" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("uiVersion muss 'alt' oder 'neu' sein");
    expect(mocks.setUiVersion).not.toHaveBeenCalled();
  });

  it("lehnt ungültiges JSON ab und schreibt nichts", async () => {
    const res = await callPatch("{", true);

    expect(res.status).toBe(400);
    expect(mocks.setUiVersion).not.toHaveBeenCalled();
  });

  it("schaltet auf die neue Oberfläche", async () => {
    const res = await callPatch({ uiVersion: "neu" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ uiVersion: "neu" });
    expect(mocks.setUiVersion).toHaveBeenCalledWith("usr_jonas", "neu");
  });
});
