import assert from "node:assert/strict";
import test from "node:test";
import type { Logger } from "./logger.js";
import { CrmClient } from "./crm-client.js";

function stubLog() {
  const warnings: unknown[][] = [];
  const log = {
    warn(...args: unknown[]) {
      warnings.push(args);
    },
  } as unknown as Logger;
  return { log, warnings };
}

function withFetch(impl: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("a missing history cursor is unsupported and stays quiet", async () => {
  const { log, warnings } = stubLog();
  const crm = new CrmClient("https://crm.example", "oc_sk_test_key", log);
  await withFetch(async () => new Response("not found", { status: 404 }), async () => {
    const cursor = await crm.getHistoryCursor("acc-kottke");
    assert.deepEqual(cursor, { supported: false, historySince: null });
  });
  assert.deepEqual(warnings, []);
});

test("a cursor 500 is unsupported and is logged", async () => {
  const { log, warnings } = stubLog();
  const crm = new CrmClient("https://crm.example", "oc_sk_test_key", log);
  await withFetch(async () => new Response("boom", { status: 500 }), async () => {
    const cursor = await crm.getHistoryCursor("acc-kottke");
    assert.deepEqual(cursor, { supported: false, historySince: null });
  });
  assert.equal(warnings.length, 1);
  const detail = warnings[0]?.[0] as { status?: number; path?: string };
  assert.equal(detail.status, 500);
  assert.match(detail.path ?? "", /baileys-history-cursor\/acc-kottke$/);
});

test("historySyncSupported must be exactly true before catch-up may post", async () => {
  const { log, warnings } = stubLog();
  const crm = new CrmClient("https://crm.example", "oc_sk_test_key", log);
  await withFetch(
    async () =>
      Response.json({
        historySyncSupported: true,
        historySince: "2026-09-01T00:00:00.000Z",
      }),
    async () => {
      const cursor = await crm.getHistoryCursor("acc-ceylan");
      assert.deepEqual(cursor, {
        supported: true,
        historySince: "2026-09-01T00:00:00.000Z",
      });
    },
  );
  await withFetch(
    async () => Response.json({ historySince: "2026-09-01T00:00:00.000Z" }),
    async () => {
      const cursor = await crm.getHistoryCursor("acc-ceylan");
      assert.deepEqual(cursor, { supported: false, historySince: null });
    },
  );
  assert.deepEqual(warnings, []);
});

test("a network failure on the cursor does not throw", async () => {
  const { log, warnings } = stubLog();
  const crm = new CrmClient("https://crm.example", "oc_sk_test_key", log);
  await withFetch(async () => {
    throw new Error("econnrefused");
  }, async () => {
    const cursor = await crm.getHistoryCursor("acc-kottke");
    assert.deepEqual(cursor, { supported: false, historySince: null });
  });
  assert.equal(warnings.length, 1);
});
