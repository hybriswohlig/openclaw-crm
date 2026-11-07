import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  pruefeNichtAngenommen: vi.fn(),
  transaction: vi.fn(),
  schritte: [] as string[],
  sperrSql: [] as unknown[],
  zeilen: [] as { id: string }[],
  updateSet: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => mocks.transaction(fn),
  },
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/kva-annahme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kva-annahme")>();
  return { ...actual, pruefeNichtAngenommen: (...args: unknown[]) => mocks.pruefeNichtAngenommen(...args) };
});

import { PATCH } from "./route";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const URL_ = "http://localhost/api/v1/deals/deal_1/quotation/anzahlung";
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const patch = (body: unknown) =>
  new NextRequest(URL_, {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const tx = {
  execute: async (q: unknown) => {
    mocks.schritte.push("sperre");
    mocks.sperrSql.push(q);
  },
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          mocks.schritte.push("lesen");
          return mocks.zeilen;
        },
      }),
    }),
  }),
  update: () => ({
    set: (v: unknown) => {
      mocks.schritte.push("update");
      mocks.updateSet(v);
      return { where: async () => undefined };
    },
  }),
  insert: () => ({
    values: async (v: unknown) => {
      mocks.schritte.push("insert");
      mocks.insertValues(v);
    },
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.schritte.length = 0;
  mocks.sperrSql.length = 0;
  mocks.zeilen = [{ id: "q1" }];
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.pruefeNichtAngenommen.mockImplementation(async () => {
    mocks.schritte.push("annahme");
  });
  mocks.transaction.mockImplementation(async (fn: (handle: typeof tx) => Promise<unknown>) => fn(tx));
});

describe("PATCH /deals/[recordId]/quotation/anzahlung", () => {
  it("Deal aus fremdem Workspace → 404, keine Transaktion", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await PATCH(patch({ depositRequiredCents: 5000 }), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NOT_FOUND", message: "Deal nicht gefunden." });
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("nach der Annahme → 409, nichts geschrieben; die Sperre ist die erste Anweisung", async () => {
    mocks.pruefeNichtAngenommen.mockImplementation(async () => {
      mocks.schritte.push("annahme");
      throw new AngebotAngenommenError();
    });
    const res = await PATCH(patch({ depositRequiredCents: 5000 }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "KVA_ACCEPTED" });
    expect(mocks.schritte).toEqual(["sperre", "annahme"]);
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    const q = new PgDialect().sqlToQuery(mocks.sperrSql[0] as SQL);
    expect(q.sql).toBe("select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))");
    expect(q.params).toEqual(["deal_1"]);
  });

  it("schreibt unter der Sperre: Lock, dann Annahme, dann Update", async () => {
    const res = await PATCH(patch({ depositRequiredCents: 5000, paymentMethodPreference: "bank_transfer" }), p());
    expect(res.status).toBe(200);
    expect(mocks.schritte).toEqual(["sperre", "annahme", "lesen", "update"]);
    expect(mocks.pruefeNichtAngenommen).toHaveBeenCalledWith("deal_1");
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ depositRequiredCents: 5000, paymentMethodPreference: "bank_transfer" }));
    const q = new PgDialect().sqlToQuery(mocks.sperrSql[0] as SQL);
    expect(q.sql).toBe("select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))");
    expect(q.params).toEqual(["deal_1"]);
  });

  it("ohne Quotation legt die Zeile in derselben Transaktion an", async () => {
    mocks.zeilen = [];
    const res = await PATCH(patch({ depositRequiredCents: 2500 }), p());
    expect(res.status).toBe(200);
    expect(mocks.schritte).toEqual(["sperre", "annahme", "lesen", "insert"]);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ dealRecordId: "deal_1", depositRequiredCents: 2500 }));
  });
});
