import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: 0,
  getSession: vi.fn(),
  getSingletonWorkspaceId: vi.fn(),
  ensureUserWorkspaceAccess: vi.fn(),
  getWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  listCalendarEvents: vi.fn(),
  getOverviewStats: vi.fn(),
  markAllAsRead: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.selects.shift() ?? []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          mocks.updates += 1;
          return { execute: () => Promise.resolve() };
        },
      }),
    }),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock("@/services/workspace", () => ({
  getSingletonWorkspaceId: mocks.getSingletonWorkspaceId,
  ensureUserWorkspaceAccess: mocks.ensureUserWorkspaceAccess,
  getWorkspace: mocks.getWorkspace,
  updateWorkspace: mocks.updateWorkspace,
}));

vi.mock("@/services/calendar/load-events", () => ({
  listCalendarEvents: mocks.listCalendarEvents,
}));

vi.mock("@/services/statistics", () => ({
  getOverviewStats: mocks.getOverviewStats,
}));

vi.mock("@/services/notifications", () => ({
  markAllAsRead: mocks.markAllAsRead,
}));

vi.mock("@/services/api-keys", () => ({
  revokeApiKey: mocks.revokeApiKey,
}));

import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { GET as calendarGet } from "@/app/api/v1/calendar/events/route";
import { GET as statsGet } from "@/app/api/v1/statistics/overview/route";
import { POST as markReadPost } from "@/app/api/v1/notifications/mark-all-read/route";
import { PATCH as patchWorkspace } from "@/app/api/v1/workspace/route";
import { DELETE as revokeKey } from "@/app/api/v1/api-keys/[keyId]/route";

function primeKey(scopes: unknown, lastUsedAt: Date | null = null) {
  mocks.updates = 0;
  mocks.selects = [
    [
      {
        id: "key1",
        userId: "user1",
        workspaceId: "ws1",
        scopes,
        expiresAt: null,
        lastUsedAt,
      },
    ],
    [{ approvalStatus: "approved", role: "member" }],
    [{ role: "admin", permissions: {} }],
  ];
}

function primeSession() {
  mocks.updates = 0;
  mocks.getSession.mockResolvedValue({ user: { id: "user1" } });
  mocks.selects = [
    [{ approvalStatus: "approved", isAppAdmin: false, role: "member" }],
  ];
  mocks.ensureUserWorkspaceAccess.mockResolvedValue({
    workspaceId: "ws1",
    role: "admin",
    permissions: {},
  });
}

function call(url: string, method: string, bearer?: string, body?: unknown) {
  const headers = new Headers();
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selects = [];
  mocks.updates = 0;
  mocks.getSession.mockResolvedValue(null);
  mocks.getSingletonWorkspaceId.mockResolvedValue("ws1");
  mocks.listCalendarEvents.mockResolvedValue({ events: [], companies: [] });
  mocks.getOverviewStats.mockResolvedValue({ deals: 3 });
  mocks.getWorkspace.mockResolvedValue({ id: "ws1", name: "Kottke" });
  mocks.updateWorkspace.mockResolvedValue({ id: "ws1", name: "Neu" });
  mocks.markAllAsRead.mockResolvedValue(undefined);
  mocks.revokeApiKey.mockResolvedValue(true);
});

describe("read-only API keys", () => {
  it("allows GET calendar and statistics", async () => {
    primeKey('["read"]');
    const calendar = await calendarGet(
      call(
        "https://crm.test/api/v1/calendar/events?from=2026-10-01&to=2026-10-07",
        "GET",
        "oc_sk_read"
      )
    );
    expect(calendar.status).toBe(200);
    expect(mocks.listCalendarEvents).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ from: "2026-10-01", to: "2026-10-07" })
    );

    primeKey('["read"]');
    const stats = await statsGet(
      call("https://crm.test/api/v1/statistics/overview", "GET", "oc_sk_read")
    );
    expect(stats.status).toBe(200);
    expect(await stats.json()).toEqual({ data: { deals: 3 } });
    expect(mocks.getOverviewStats).toHaveBeenCalledWith("ws1");
  });

  it("allows HEAD and OPTIONS and blocks POST, PATCH, and DELETE with 403", async () => {
    primeKey('["read"]');
    const head = await getAuthContext(
      call("https://crm.test/api/v1/statistics/overview", "HEAD", "oc_sk_read")
    );
    expect(head?.apiKeyAccess).toBe("read");

    primeKey('["read"]');
    const options = await getAuthContext(
      call("https://crm.test/api/v1/statistics/overview", "OPTIONS", "oc_sk_read")
    );
    expect(options?.authMethod).toBe("api_key");

    primeKey('["read"]');
    const post = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_read")
    );
    expect(post.status).toBe(403);
    expect(await post.json()).toEqual({
      error: {
        code: "INSUFFICIENT_SCOPE",
        message:
          "This API key is read-only and cannot call POST. Read-only keys may only use GET, HEAD, and OPTIONS.",
      },
    });
    expect(mocks.markAllAsRead).not.toHaveBeenCalled();
    expect(mocks.updates).toBe(0);

    primeKey('["read"]');
    const patch = await patchWorkspace(
      call("https://crm.test/api/v1/workspace", "PATCH", "oc_sk_read", { name: "Neu" })
    );
    expect(patch.status).toBe(403);
    expect(mocks.updateWorkspace).not.toHaveBeenCalled();

    primeKey('["read"]');
    const del = await revokeKey(
      call("https://crm.test/api/v1/api-keys/key1", "DELETE", "oc_sk_read"),
      { params: Promise.resolve({ keyId: "key1" }) }
    );
    expect(del.status).toBe(403);
    expect(mocks.revokeApiKey).not.toHaveBeenCalled();
  });

  it("enforces the double-encoded production string and a real array", async () => {
    primeKey('["*"]');
    const fullString = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_full")
    );
    expect(fullString.status).toBe(200);
    expect(mocks.markAllAsRead).toHaveBeenCalledTimes(1);

    primeKey(["*"]);
    const fullArray = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_full")
    );
    expect(fullArray.status).toBe(200);

    primeKey('["read"]');
    const readString = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_read")
    );
    expect(readString.status).toBe(403);
    expect(await readString.json()).toMatchObject({
      error: { code: "INSUFFICIENT_SCOPE" },
    });

    primeKey(["read"]);
    const readArray = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_read")
    );
    expect(readArray.status).toBe(403);
    expect(mocks.markAllAsRead).toHaveBeenCalledTimes(2);
  });

  it("still authenticates read-only keys on the MCP endpoint", async () => {
    primeKey('["read"]');
    const ctx = await getAuthContext(
      call("https://crm.test/api/mcp", "POST", "oc_sk_read", { jsonrpc: "2.0" })
    );
    expect(ctx).toMatchObject({ authMethod: "api_key", apiKeyAccess: "read", userId: "user1" });
    const res = unauthorized();
    expect(res.status).toBe(401);
  });
});

describe("full, legacy, and session auth", () => {
  it.each([
    ["wildcard", '["*"]'],
    ["write", '["write"]'],
    ["full", '["full"]'],
    ["admin", '["admin"]'],
    ["mixed", '["read","*"]'],
    ["empty", "[]"],
    ["invalid", "not-json"],
    ["null", null],
  ])("keeps %s scopes able to POST", async (_label, scopes) => {
    primeKey(scopes);
    const res = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_full")
    );
    expect(res.status).toBe(200);
    expect(mocks.markAllAsRead).toHaveBeenCalledWith("ws1", "user1");
  });

  it("leaves session cookie auth unrestricted", async () => {
    primeSession();
    const res = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST")
    );
    expect(res.status).toBe(200);
    expect(mocks.getSession).toHaveBeenCalled();
    expect(mocks.markAllAsRead).toHaveBeenCalledWith("ws1", "user1");

    primeSession();
    const patch = await patchWorkspace(
      call("https://crm.test/api/v1/workspace", "PATCH", undefined, { name: "Neu" })
    );
    expect(patch.status).toBe(200);
    expect(mocks.updateWorkspace).toHaveBeenCalledWith("ws1", { name: "Neu" });
  });

  it("does not turn a later request into 403 after a denied read-only call", async () => {
    primeKey('["read"]');
    const denied = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_read")
    );
    expect(denied.status).toBe(403);

    primeKey('["*"]');
    const allowed = await markReadPost(
      call("https://crm.test/api/v1/notifications/mark-all-read", "POST", "oc_sk_full")
    );
    expect(allowed.status).toBe(200);
  });
});
