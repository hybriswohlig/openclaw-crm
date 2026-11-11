import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TARGET = "82027c02-f0da-49db-923a-12a1d0f9a552";
const OTHER = "595a5e23-0000-0000-0000-000000000000";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  deleteSetting: vi.fn(),
  limit: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.limit }),
      }),
    }),
    update: () => ({
      set: (patch: unknown) => {
        mocks.set(patch);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@/services/workspace-settings", () => ({
  deleteSetting: mocks.deleteSetting,
}));

import { POST } from "./route";

function request(accountId = TARGET) {
  return new NextRequest("http://localhost/api/v1/integrations/baileys/repair", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
}

const manager = {
  userId: "usr_1",
  workspaceId: "ws",
  workspaceRole: "member" as const,
  permissions: { manageChannels: true },
  authMethod: "cookie" as const,
};

describe("POST /api/v1/integrations/baileys/repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BAILEYS_BRIDGE_URL = "https://bridge.test";
    process.env.BAILEYS_BRIDGE_SECRET = "sek";
    mocks.getAuthContext.mockResolvedValue(manager);
    mocks.deleteSetting.mockResolvedValue(undefined);
    mocks.limit.mockResolvedValue([
      { id: TARGET, isActive: false, baileysPairingStatus: "logged_out" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/health")) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refuses a member who cannot manage channels and does not touch sessions", async () => {
    mocks.getAuthContext.mockResolvedValue({
      ...manager,
      permissions: {},
    });
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not clear a connected account", async () => {
    mocks.limit.mockResolvedValue([
      { id: OTHER, isActive: true, baileysPairingStatus: "connected" },
    ]);
    const res = await POST(request(OTHER));
    expect(res.status).toBe(409);
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("clears only the requested account, reactivates it, and starts that socket", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accountId: TARGET });

    expect(mocks.deleteSetting).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSetting).toHaveBeenCalledWith("ws", `baileys.auth_state.${TARGET}`);

    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set.mock.calls[0][0]).toMatchObject({
      isActive: true,
      baileysPairingStatus: "awaiting_qr",
      baileysQrPayload: null,
      baileysPairingCode: null,
      baileysLastDisconnectReason: null,
    });

    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      `https://bridge.test/accounts/${TARGET}/health`,
      `https://bridge.test/accounts/${TARGET}/start`,
    ]);
    expect(urls.join(" ")).not.toContain(OTHER);
    expect(urls.join(" ")).not.toContain("/send");
    const startInit = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as RequestInit;
    expect(startInit.method).toBe("POST");
    expect((startInit.headers as Record<string, string>)["X-Bridge-Secret"]).toBe("sek");
  });

  it("stops a live socket and waits out the auth flush before deleting", async () => {
    vi.useFakeTimers();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ id: TARGET, status: "logged_out" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(800);
    const res = await pending;
    expect(res.status).toBe(200);

    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      `https://bridge.test/accounts/${TARGET}/health`,
      `https://bridge.test/accounts/${TARGET}/stop`,
      `https://bridge.test/accounts/${TARGET}/start`,
    ]);
    const deleteOrder = mocks.deleteSetting.mock.invocationCallOrder[0];
    const startOrder = (fetch as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[2];
    expect(deleteOrder).toBeLessThan(startOrder);
  });

  it("does not delete the session when the bridge rejects the secret", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
