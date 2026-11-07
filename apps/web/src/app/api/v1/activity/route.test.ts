import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn(), where: [] as unknown[] }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          mocks.where.push(w);
          return { orderBy: () => ({ limit: async () => [] }) };
        },
      }),
    }),
  },
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.where.length = 0;
  mocks.getAuthContext.mockResolvedValue({ userId: "u1", workspaceId: "ws_1", workspaceRole: "admin", permissions: {} });
});

describe("GET /api/v1/activity", () => {
  it("lässt die Zählungen aus Plan 14 aus dem Startseiten-Feed", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/activity?limit=6"));
    expect(res.status).toBe(200);
    const q = new PgDialect().sqlToQuery(mocks.where[0] as SQL);
    expect(q.sql).toContain('"event_type" not in');
    expect(q.params).toEqual(["ws_1", "quotation.put", "alte_seite.aufruf"]);
  });
});
