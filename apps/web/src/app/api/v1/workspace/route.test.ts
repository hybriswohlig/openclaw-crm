import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// GET /api/v1/workspace is loaded by the sidebar on every page for every
// member; it returned the raw settings row including the OpenRouter API key.
// PATCH must not erase the key when /settings sends back the (now redacted)
// settings object it got from GET.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/workspace", () => ({
  getWorkspace: mocks.getWorkspace,
  updateWorkspace: mocks.updateWorkspace,
}));

import { GET, PATCH } from "./route";

const WORKSPACE_ID = "ws_kottke_prod";
const STORED = {
  id: WORKSPACE_ID,
  name: "Kottke",
  settings: { openrouterApiKey: "sk-or-secret", logo: "<svg/>", openrouterModel: "m" },
};

function ctx(role: "admin" | "member") {
  return { userId: "usr_1", workspaceId: WORKSPACE_ID, workspaceRole: role, permissions: {} };
}

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/workspace", {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

describe("/api/v1/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue(structuredClone(STORED));
    mocks.updateWorkspace.mockImplementation(async (_id, input) => ({ ...STORED, ...input }));
  });

  it("GET does not return the OpenRouter key to a member", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("member"));
    const res = await GET(req("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.settings).toEqual({ logo: "<svg/>", openrouterModel: "m" });
    expect(JSON.stringify(body)).not.toContain("sk-or-secret");
  });

  it("PATCH keeps the stored key and does not echo it", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("admin"));
    const res = await PATCH(
      req("PATCH", { name: "Kottke", settings: { logo: "<svg2/>", openrouterModel: "m" } })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, {
      name: "Kottke",
      settings: { logo: "<svg2/>", openrouterModel: "m", openrouterApiKey: "sk-or-secret" },
    });
    expect(JSON.stringify(body)).not.toContain("sk-or-secret");
  });

  it("PATCH by a member is still refused", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("member"));
    const res = await PATCH(req("PATCH", { settings: {} }));
    expect(res.status).toBe(400);
    expect(mocks.updateWorkspace).not.toHaveBeenCalled();
  });
});
