import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// "One pending draft per (deal, class)" kept the FIRST reply draft when the
// customer wrote again: the newer message got no draft, and approving the old
// one later answered a question the customer had moved past. For replies the
// newest draft must win; follow-ups keep the one-pending rule (the daily
// re-composed nudge for the same silent lead must not re-push every day).
const state = vi.hoisted(() => ({
  pending: [] as unknown[],
  insertReturn: [] as unknown[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as { set: Record<string, unknown>; where?: SQL }[],
  freigabe: vi.fn(),
}));

vi.mock("@/db", () => {
  const chain = (result: unknown, onWhere?: (w: SQL) => void) => {
    const q: Record<string, unknown> = {};
    for (const m of ["from", "limit", "onConflictDoNothing"]) q[m] = () => q;
    q.where = (w: SQL) => {
      onWhere?.(w);
      return q;
    };
    q.values = (v: Record<string, unknown>) => {
      state.inserts.push(v);
      return q;
    };
    q.returning = () => Promise.resolve(result);
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
    return q;
  };
  return {
    db: {
      select: () => chain(state.pending),
      insert: () => chain(state.insertReturn),
      update: () => ({
        set: (set: Record<string, unknown>) => {
          const entry: { set: Record<string, unknown>; where?: SQL } = { set };
          state.updates.push(entry);
          return chain([], (w) => {
            entry.where = w;
          });
        },
      }),
    },
  };
});
vi.mock("@/services/push", () => ({ sendPush: vi.fn() }));
vi.mock("./agent-shared", () => ({ ownerUserIds: vi.fn(async () => []) }));
vi.mock("./agent-gate", () => ({ agentMayContact: vi.fn() }));
vi.mock("./agent-suppress", () => ({ leaksPriceOrCommitment: () => false }));
vi.mock("@/services/intern/freigabe", () => ({ freigabeAnfragen: state.freigabe }));

import { captureShadowDraft } from "./agent-shadow";

const dialect = new PgDialect();
const GATE = { allowed: true, reasons: [], context: {} };
const input = (messageClass: "reply" | "followup", draftText = "Wann soll der Umzug sein?") => ({
  workspaceId: "ws",
  engine: messageClass === "reply" ? ("reply" as const) : ("followup" as const),
  messageClass,
  dealRecordId: "deal-1",
  conversationId: "conv-1",
  channelAccountId: "acc-1",
  draftText,
  gate: GATE,
});

describe("captureShadowDraft", () => {
  beforeEach(() => {
    state.pending = [];
    state.insertReturn = [];
    state.inserts = [];
    state.updates = [];
    state.freigabe.mockReset();
  });

  it("newer reply supersedes the pending one", async () => {
    state.pending = [{ id: "old" }];
    state.insertReturn = [{ id: "new" }];
    await captureShadowDraft(input("reply"));

    expect(state.inserts).toHaveLength(1);
    const supersede = state.updates.find((u) => u.set.status === "superseded");
    expect(supersede).toBeDefined();
    const params = dialect.sqlToQuery(supersede!.where!).params;
    expect(params).toEqual(expect.arrayContaining(["deal-1", "reply", "pending", "new"]));
    expect(state.freigabe).toHaveBeenCalledWith(expect.objectContaining({ draftId: "new" }));
  });

  it("same text keeps the pending draft", async () => {
    state.pending = [{ id: "old" }];
    state.insertReturn = [];
    await captureShadowDraft(input("reply"));

    expect(state.updates.some((u) => u.set.status === "superseded")).toBe(false);
    expect(state.freigabe).not.toHaveBeenCalled();
  });

  it("follow-up keeps one pending draft", async () => {
    state.pending = [{ id: "old" }];
    state.insertReturn = [{ id: "new" }];
    await captureShadowDraft(input("followup"));

    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(state.freigabe).not.toHaveBeenCalled();
  });
});
