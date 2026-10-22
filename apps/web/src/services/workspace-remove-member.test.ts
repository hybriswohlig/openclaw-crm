import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { sessions, users, workspaceMembers } from "@/db/schema";

// Single-workspace deployment: getAuthContext → ensureUserWorkspaceAccess
// re-creates a missing membership for any approved user. Deleting only the
// membership row therefore did not end access. Removal must do what the
// admin "reject" route does: mark the user rejected and end their sessions.
type Write = { op: "delete" | "update"; table: unknown; values?: Record<string, unknown>; where?: SQL };

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  writes: [] as Write[],
}));

vi.mock("@/db", () => {
  const select = () => ({
    from: () => ({
      where: () => {
        const rows = state.selects.shift() ?? [];
        return Object.assign(Promise.resolve(rows), { limit: async () => rows });
      },
    }),
  });
  const writer = {
    delete: (table: unknown) => ({
      where: async (where: SQL) => {
        state.writes.push({ op: "delete", table, where });
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: SQL) => {
          state.writes.push({ op: "update", table, values, where });
        },
      }),
    }),
  };
  return {
    db: { select, ...writer, transaction: async (fn: (tx: typeof writer) => unknown) => fn(writer) },
  };
});

import { removeMember } from "./workspace";

const dialect = new PgDialect();
const params = (where?: SQL) => (where ? dialect.sqlToQuery(where).params : []);

const MEMBER = { id: "mem_2", workspaceId: "ws", userId: "usr_2", role: "member" };

describe("removeMember", () => {
  beforeEach(() => {
    state.selects = [];
    state.writes = [];
  });

  it("rejects the removed user and ends their sessions", async () => {
    state.selects = [[MEMBER]];
    await expect(removeMember("ws", "mem_2", "usr_admin")).resolves.toEqual(MEMBER);

    const membership = state.writes.find((w) => w.op === "delete" && w.table === workspaceMembers);
    expect(params(membership?.where)).toContain("mem_2");

    const sessionDelete = state.writes.find((w) => w.op === "delete" && w.table === sessions);
    expect(params(sessionDelete?.where)).toEqual(["usr_2"]);

    const userUpdate = state.writes.find((w) => w.op === "update" && w.table === users);
    expect(userUpdate?.values).toMatchObject({ approvalStatus: "rejected" });
    expect(params(userUpdate?.where)).toEqual(["usr_2"]);
  });

  it("refuses to remove yourself", async () => {
    state.selects = [[{ ...MEMBER, userId: "usr_admin", role: "admin" }]];
    await expect(removeMember("ws", "mem_2", "usr_admin")).rejects.toThrow("Cannot remove yourself");
    expect(state.writes).toEqual([]);
  });

  it("still protects the last admin", async () => {
    state.selects = [[{ ...MEMBER, role: "admin" }], [{ id: "mem_2", role: "admin" }]];
    await expect(removeMember("ws", "mem_2", "usr_admin")).rejects.toThrow("Cannot remove the last admin");
    expect(state.writes).toEqual([]);
  });
});
