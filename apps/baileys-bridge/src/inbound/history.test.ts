import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_FALLBACK_MS,
  HISTORY_OVERLAP_MS,
  historyCatchupConfig,
  historyCutoffMs,
  isWithinHistoryWindow,
  shouldKeepHistoryMessage,
} from "./history.js";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

test("cutoff follows the newest CRM message, with overlap", () => {
  const since = new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(historyCutoffMs(since, NOW), Date.parse(since) - HISTORY_OVERLAP_MS);
});

test("missing cursor falls back to 21 days", () => {
  assert.equal(historyCutoffMs(null, NOW), NOW - HISTORY_FALLBACK_MS);
  assert.equal(historyCutoffMs("not-a-date", NOW), NOW - HISTORY_FALLBACK_MS);
});

test("window accepts the gap and rejects older history", () => {
  const cutoff = historyCutoffMs(
    new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString(),
    NOW,
  );
  assert.equal(isWithinHistoryWindow(NOW - 2 * 24 * 60 * 60 * 1000, cutoff), true);
  assert.equal(isWithinHistoryWindow(NOW - 40 * 24 * 60 * 60 * 1000, cutoff), false);
  assert.equal(isWithinHistoryWindow(0, cutoff), false);
});

test("a restored session does not arm catch-up when the cursor route is missing", () => {
  assert.equal(
    historyCatchupConfig({
      freshPair: false,
      cursorSupported: false,
      historySince: null,
      now: NOW,
    }),
    null,
  );
});

test("a fresh pair with no cursor spools and does not post", () => {
  const history = historyCatchupConfig({
    freshPair: true,
    cursorSupported: false,
    historySince: "2026-09-01T00:00:00.000Z",
    now: NOW,
  });
  assert.ok(history);
  assert.equal(history.postToCrm, false);
  assert.equal(history.cutoffMs, NOW - HISTORY_FALLBACK_MS);
});

test("an opt-in cursor posts and uses the stored watermark", () => {
  const since = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
  const history = historyCatchupConfig({
    freshPair: false,
    cursorSupported: true,
    historySince: since,
    now: NOW,
  });
  assert.ok(history);
  assert.equal(history.postToCrm, true);
  assert.equal(history.cutoffMs, Date.parse(since) - HISTORY_OVERLAP_MS);
});

test("bridge-send echoes inside the window are not catch-up rows", () => {
  const cutoff = NOW - HISTORY_FALLBACK_MS;
  const sentAt = NOW - 60 * 1000;
  assert.equal(
    shouldKeepHistoryMessage(sentAt, cutoff, "BAE5SENT", (id) => id === "BAE5SENT"),
    false,
  );
  assert.equal(
    shouldKeepHistoryMessage(sentAt, cutoff, "BAE5PHONE", (id) => id === "BAE5SENT"),
    true,
  );
  assert.equal(shouldKeepHistoryMessage(NOW - 40 * 24 * 60 * 60 * 1000, cutoff, "OLD", () => false), false);
});
