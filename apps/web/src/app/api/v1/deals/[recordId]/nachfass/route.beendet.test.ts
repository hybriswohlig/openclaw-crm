import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * PUT gegen den echten Schalter-Dienst: bei beendeter Sequenz 409 und keine
 * einzige Schreibfunktion. `db.execute` liefert die Lesezeile; jede andere
 * DB-Nutzung lässt den Test scheitern.
 */
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  execute: vi.fn(),
  releaseHumanOwnership: vi.fn(),
  getDealStageCategory: vi.fn(),
  supersedePendingDrafts: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "execute") return mocks.execute;
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`@/db im Test (${String(p)})`);
      },
    }
  ),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/agent/agent-gate", () => ({
  releaseHumanOwnership: mocks.releaseHumanOwnership,
  getDealStageCategory: mocks.getDealStageCategory,
}));
vi.mock("@/services/agent/draft-schliessen", () => ({
  supersedePendingDrafts: mocks.supersedePendingDrafts,
}));
vi.mock("@/services/agent/agent-config", () => ({
  isSalesAgentDryRun: vi.fn(async () => true),
  isEngineDryRun: vi.fn(async () => true),
}));

import { PUT } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const put = (an: boolean) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/nachfass", {
    method: "PUT",
    body: JSON.stringify({ an }),
    headers: { "content-type": "application/json" },
  });
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const dialekt = new PgDialect();
const sqlText = (q: unknown) => dialekt.sqlToQuery(q as SQL).sql.replace(/\s+/g, " ").trim();

function dealZeile(stopReason: string | null, fremdeFirma = false) {
  return {
    stop_reason: stopReason,
    fu1_sent_at: null,
    fu2_sent_at: null,
    close_sent_at: null,
    human_owned: true,
    ai_paused: true,
    oc: "oc_1",
    state_oc: null,
    kv_sent_at: null,
    kv_doc_at: null,
    fremde_firma: fremdeFirma,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
});

describe.each([
  ["optout", dealZeile("optout"), "quoted"],
  ["lost", dealZeile(null), "lost"],
  ["kunde_hat_geantwortet", dealZeile("kunde_hat_geantwortet"), "quoted"],
  ["booked", dealZeile(null), "booked"],
  ["paid", dealZeile(null), "paid"],
  ["fremde Firma", dealZeile(null, true), "quoted"],
])("PUT bei beendeter Sequenz (%s)", (_name, zeile, category) => {
  it.each([true, false])("an = %s → 409 BEENDET, nichts geschrieben", async (an) => {
    mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "x", category, isTerminal: false });
    mocks.execute.mockImplementation(async (q: unknown) =>
      /from nachfass_rule_switches/i.test(sqlText(q)) ? [] : [zeile]
    );
    const res = await PUT(put(an), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: "BEENDET",
      message: "Die Nachfass-Sequenz ist für diesen Deal beendet.",
    });
    expect(mocks.releaseHumanOwnership).not.toHaveBeenCalled();
    expect(mocks.supersedePendingDrafts).not.toHaveBeenCalled();
    const statements = mocks.execute.mock.calls.map(([q]) => sqlText(q));
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((t) => /^select/i.test(t))).toBe(true);
  });
});
