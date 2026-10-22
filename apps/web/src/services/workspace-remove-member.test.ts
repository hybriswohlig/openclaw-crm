import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { calendarFeedTokens, pushSubscriptions, sessions, users, workspaceMembers } from "@/db/schema";

// Single-workspace deployment: getAuthContext → ensureUserWorkspaceAccess
// re-creates a missing membership for any approved user. Deleting only the
// membership row therefore did not end access. Removal must do what the
// admin "reject" route does: mark the user rejected and end every way they
// still receive data (sessions, push notifications, calendar feed).
type Write = {
  via: "db" | "tx";
  op: "delete" | "update";
  table: unknown;
  values?: Record<string, unknown>;
  where?: SQL;
};

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
  const writer = (via: "db" | "tx") => ({
    delete: (table: unknown) => ({
      where: async (where: SQL) => {
        state.writes.push({ via, op: "delete", table, where });
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: SQL) => {
          state.writes.push({ via, op: "update", table, values, where });
        },
      }),
    }),
  });
  return {
    db: {
      select,
      ...writer("db"),
      transaction: async (fn: (tx: ReturnType<typeof writer>) => unknown) => fn(writer("tx")),
    },
  };
});

import { removeMember } from "./workspace";

const dialect = new PgDialect();
const params = (where?: SQL) => (where ? dialect.sqlToQuery(where).params : []);
const find = (op: Write["op"], table: unknown) =>
  state.writes.find((w) => w.op === op && w.table === table);

const MEMBER = { id: "mem_2", workspaceId: "ws", userId: "usr_2", role: "member" };
const PLAIN_USER = [{ isAppAdmin: false }];

describe("removeMember", () => {
  beforeEach(() => {
    state.selects = [];
    state.writes = [];
  });

  it("rejects the removed user and ends their sessions in one transaction", async () => {
    state.selects = [[MEMBER], PLAIN_USER];
    await expect(removeMember("ws", "mem_2", "usr_admin")).resolves.toEqual(MEMBER);

    expect(params(find("delete", workspaceMembers)?.where)).toContain("mem_2");
    expect(params(find("delete", sessions)?.where)).toEqual(["usr_2"]);
    const userUpdate = find("update", users);
    expect(userUpdate?.values).toMatchObject({ approvalStatus: "rejected" });
    expect(params(userUpdate?.where)).toEqual(["usr_2"]);
    expect(state.writes.every((w) => w.via === "tx")).toBe(true);
  });

  it("stops push notifications and the calendar feed of the removed user", async () => {
    state.selects = [[MEMBER], PLAIN_USER];
    await removeMember("ws", "mem_2", "usr_admin");

    expect(params(find("delete", pushSubscriptions)?.where)).toEqual(["usr_2"]);
    const feed = find("update", calendarFeedTokens);
    expect(feed?.values?.revokedAt).toBeInstanceOf(Date);
    expect(params(feed?.where)).toContain("usr_2");
  });

  it("refuses to remove yourself", async () => {
    state.selects = [[{ ...MEMBER, userId: "usr_admin", role: "admin" }]];
    await expect(removeMember("ws", "mem_2", "usr_admin")).rejects.toThrow(
      "Du kannst dich nicht selbst entfernen."
    );
    expect(state.writes).toEqual([]);
  });

  it("refuses to remove an app admin", async () => {
    state.selects = [[{ ...MEMBER, role: "admin" }], [{ isAppAdmin: true }]];
    await expect(removeMember("ws", "mem_2", "usr_admin")).rejects.toThrow(
      "App-Admins lassen sich hier nicht entfernen."
    );
    expect(state.writes).toEqual([]);
  });

  it("still protects the last admin", async () => {
    state.selects = [[{ ...MEMBER, role: "admin" }], PLAIN_USER, [{ id: "mem_2", role: "admin" }]];
    await expect(removeMember("ws", "mem_2", "usr_admin")).rejects.toThrow(
      "Der letzte Admin kann nicht entfernt werden."
    );
    expect(state.writes).toEqual([]);
  });
});
