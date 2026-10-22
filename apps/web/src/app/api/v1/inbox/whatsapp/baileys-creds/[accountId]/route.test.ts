import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// This route hands out (and accepts) the WhatsApp device's Signal auth state.
// Only the Baileys bridge, authenticating with a full `oc_sk_*` API key, may
// call it — a member's browser session must not be able to clone or wipe the
// company's linked WhatsApp device.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSetting: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ id: "acc", workspaceId: "ws" }] }) }),
    }),
  },
}));

vi.mock("@/services/workspace-settings", () => ({
  getSecret: mocks.getSecret,
  setSecret: mocks.setSecret,
  deleteSetting: mocks.deleteSetting,
}));

import { GET, PUT } from "./route";

const base = { userId: "usr_1", workspaceId: "ws", workspaceRole: "admin" as const, permissions: {} };
const params = { params: Promise.resolve({ accountId: "acc" }) };

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/inbox/whatsapp/baileys-creds/acc", {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

describe("/api/v1/inbox/whatsapp/baileys-creds/[accountId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSecret.mockResolvedValue(JSON.stringify({ a: 1 }));
  });

  it("cookie session cannot read the state", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...base, authMethod: "cookie" });
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(403);
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it("read-only API key cannot read the state", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...base, authMethod: "api_key", apiKeyAccess: "read" });
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(403);
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it("full API key still gets the state", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...base, authMethod: "api_key", apiKeyAccess: "full" });
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: { a: 1 } });
  });

  it("cookie session cannot overwrite the state", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...base, authMethod: "cookie" });
    const res = await PUT(req("PUT", { state: { evil: true } }), params);
    expect(res.status).toBe(403);
    expect(mocks.setSecret).not.toHaveBeenCalled();
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
  });
});
