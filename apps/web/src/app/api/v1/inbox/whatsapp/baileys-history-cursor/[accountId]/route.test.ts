import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.limit,
        }),
      }),
    }),
  },
}));

import { GET } from "./route";

const WORKSPACE = "ws-kottke";
const KOTTKE = "82027c02-f0da-49db-923a-12a1d0f9a552";
const CEYLAN = "595a5e23-69c6-4f28-9254-307521ad1e74";

function call(accountId: string) {
  return GET(
    new NextRequest(`https://crm.test/api/v1/inbox/whatsapp/baileys-history-cursor/${accountId}`, {
      headers: { authorization: "Bearer oc_sk_test" },
    }),
    { params: Promise.resolve({ accountId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BAILEYS_HISTORY_SYNC_DAYS;
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: WORKSPACE,
    workspaceRole: "admin",
    permissions: {},
    authMethod: "api_key",
    apiKeyAccess: "full",
  });
  mocks.limit.mockResolvedValue([{ id: KOTTKE }]);
});

describe("GET /baileys-history-cursor", () => {
  it("opts the Kottke account into a 7-day window", async () => {
    const before = Date.now();
    const res = await call(KOTTKE);
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.historySyncSupported).toBe(true);
    expect(body.windowDays).toBe(7);
    const since = Date.parse(body.historySince);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - sevenDays - 1000);
    expect(since).toBeLessThanOrEqual(after - sevenDays + 1000);
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("honours BAILEYS_HISTORY_SYNC_DAYS inside 1..30", async () => {
    process.env.BAILEYS_HISTORY_SYNC_DAYS = "3";
    const res = await call(KOTTKE);
    const body = await res.json();
    expect(body.windowDays).toBe(3);
    const age = Date.now() - Date.parse(body.historySince);
    expect(age).toBeGreaterThan(3 * 24 * 60 * 60 * 1000 - 5000);
    expect(age).toBeLessThan(3 * 24 * 60 * 60 * 1000 + 5000);
  });

  it("does not read the database for an excluded account", async () => {
    const res = await call(CEYLAN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ historySyncSupported: false, historySince: null });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("404s when the account is not this workspace's in-house Baileys row", async () => {
    mocks.limit.mockResolvedValue([]);
    const res = await call("11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(404);
  });

  it("rejects a browser session", async () => {
    mocks.getAuthContext.mockResolvedValue({
      userId: "usr_1",
      workspaceId: WORKSPACE,
      workspaceRole: "admin",
      permissions: {},
      authMethod: "cookie",
    });
    const res = await call(KOTTKE);
    expect(res.status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
