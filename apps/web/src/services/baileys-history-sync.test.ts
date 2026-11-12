import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_WINDOW_DAYS,
  HISTORY_OVERLAP_MS,
  followupTrailingOutbound,
  historyIngestEffects,
  historySinceForBridge,
  historyWindowDays,
  historyWindowStartMs,
  isHistorySyncExcludedAccount,
  isHistorySyncMarker,
  isSkippedWhatsAppThread,
  planHistoryImport,
} from "./baileys-history-sync";

const HERE = dirname(fileURLToPath(import.meta.url));
const KOTTKE = "82027c02-f0da-49db-923a-12a1d0f9a552";
const CEYLAN_A = "595a5e23-69c6-4f28-9254-307521ad1e74";
const CEYLAN_B = "61cd807b-72c6-4fb7-af83-ef7145e93386";
const NOW = Date.parse("2026-11-11T19:40:00.000Z");
const SINCE = Date.parse("2026-11-04T19:40:00.000Z");

describe("history window", () => {
  it("defaults to 7 days and ignores out-of-range overrides", () => {
    expect(historyWindowDays("")).toBe(DEFAULT_HISTORY_WINDOW_DAYS);
    expect(historyWindowDays(undefined)).toBe(7);
    expect(historyWindowDays("7")).toBe(7);
    expect(historyWindowDays("14")).toBe(14);
    expect(historyWindowDays("0")).toBe(7);
    expect(historyWindowDays("31")).toBe(7);
    expect(historyWindowDays("3.5")).toBe(7);
  });

  it("tells the bridge a since that lands on the window after its overlap", () => {
    const since = Date.parse(historySinceForBridge(new Date(NOW), 7));
    expect(since - HISTORY_OVERLAP_MS).toBe(historyWindowStartMs(NOW, 7));
    expect(NOW - (since - HISTORY_OVERLAP_MS)).toBe(7 * 24 * 60 * 60 * 1000 + HISTORY_OVERLAP_MS);
  });
});

describe("history ingest effects", () => {
  it("stores the row and does not arm, push, scan, approve, or send", () => {
    expect(historyIngestEffects()).toEqual({
      storeOnTimeline: true,
      armAgent: false,
      staffPush: false,
      scanReviews: false,
      emitActivity: false,
      executeApprovalCommands: false,
      storeInternalNumbers: false,
      takeHumanOwnership: false,
      sendsWhatsApp: false,
      sendsEmail: false,
      aiSkipReason: "history-sync",
    });
  });
});

describe("thread and account guards", () => {
  it("refuses both Ceylan accounts and keeps the Kottke account", () => {
    expect(isHistorySyncExcludedAccount(CEYLAN_A)).toBe(true);
    expect(isHistorySyncExcludedAccount(CEYLAN_B)).toBe(true);
    expect(isHistorySyncExcludedAccount(KOTTKE)).toBe(false);
  });

  it("skips groups, newsletters, and status", () => {
    expect(isSkippedWhatsAppThread("120363000@g.us")).toBe(true);
    expect(isSkippedWhatsAppThread("123@newsletter")).toBe(true);
    expect(isSkippedWhatsAppThread("status@broadcast")).toBe(true);
    expect(isSkippedWhatsAppThread("491511112233@s.whatsapp.net")).toBe(false);
    expect(isHistorySyncMarker('{"source":"history-sync"}')).toBe(true);
    expect(isHistorySyncMarker({ historySync: true })).toBe(true);
    expect(isHistorySyncMarker({ source: "phone-direct" })).toBe(false);
  });
});

describe("follow-up speaker", () => {
  it("ignores imported outbound rows so a backfill cannot look like we just wrote", () => {
    const speaker = followupTrailingOutbound([
      { direction: "inbound", historySync: false },
      { direction: "outbound", historySync: true },
    ]);
    expect(speaker.lastIsOutbound).toBe(false);
    expect(speaker.trailing).toBe(0);
  });

  it("still sees a live outbound after an imported customer message", () => {
    const speaker = followupTrailingOutbound([
      { direction: "inbound", historySync: true },
      { direction: "outbound", historySync: false },
      { direction: "outbound", historySync: false },
    ]);
    expect(speaker.lastIsOutbound).toBe(true);
    expect(speaker.trailing).toBe(2);
  });
});

describe("planHistoryImport", () => {
  const gap = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();

  it("keeps this account's gap messages and drops everything else", () => {
    const plan = planHistoryImport(
      [
        {
          kind: "in",
          payload: {
            accountId: KOTTKE,
            peerJid: "491511112233@s.whatsapp.net",
            externalMessageId: "wamid.GAP",
            body: "Sind Sie noch da?",
            sentAt: gap,
          },
        },
        {
          kind: "out",
          payload: {
            accountId: KOTTKE,
            peerWaId: "491511112233",
            externalMessageId: "wamid.OURS",
            body: "Ja",
            sentAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
          },
        },
        {
          kind: "in",
          payload: {
            accountId: KOTTKE,
            peerJid: "120363000@g.us",
            externalMessageId: "wamid.GROUP",
            body: "Gruppe",
            sentAt: gap,
          },
        },
        {
          kind: "in",
          payload: {
            accountId: KOTTKE,
            peerJid: "491511112233@s.whatsapp.net",
            externalMessageId: "wamid.OLD",
            body: "vor acht Tagen",
            sentAt: new Date(SINCE - 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        {
          kind: "in",
          payload: {
            accountId: CEYLAN_A,
            peerJid: "491511112233@s.whatsapp.net",
            externalMessageId: "wamid.CEYLAN",
            body: "nicht anfassen",
            sentAt: gap,
          },
        },
        {
          kind: "in",
          payload: {
            accountId: KOTTKE,
            peerJid: "491511112233@s.whatsapp.net",
            externalMessageId: "wamid.GAP",
            body: "duplikat",
            sentAt: gap,
          },
        },
      ],
      { accountId: KOTTKE, sinceMs: SINCE },
    );

    expect(plan.importRows.map((row) => row.externalMessageId)).toEqual(["wamid.GAP", "wamid.OURS"]);
    expect(plan.importRows[0]).toMatchObject({ kind: "in", peerWaId: "491511112233", body: "Sind Sie noch da?" });
    expect(plan.skipped).toMatchObject({
      group_or_status: 1,
      outside_window: 1,
      excluded_account: 1,
      duplicate_in_file: 1,
    });
  });

  it("imports nothing when the requested account is excluded", () => {
    const plan = planHistoryImport(
      [
        {
          kind: "in",
          payload: {
            accountId: CEYLAN_B,
            peerWaId: "491511112233",
            externalMessageId: "wamid.X",
            body: "hallo",
            sentAt: gap,
          },
        },
      ],
      { accountId: CEYLAN_B, sinceMs: SINCE },
    );
    expect(plan.importRows).toEqual([]);
    expect(plan.skipped.excluded_account).toBe(1);
  });
});

describe("history import has no send path", () => {
  it("the apply module and the script never call WhatsApp or email", () => {
    const apply = readFileSync(join(HERE, "baileys-history-apply.ts"), "utf8");
    const script = readFileSync(join(HERE, "../../scripts/import-baileys-history.ts"), "utf8");
    for (const src of [apply, script]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(
        /callBridgeSend|sendBaileys|BAILEYS_BRIDGE|sendMessage|verarbeiteInterneNachricht|sendeAnInterne|nodemailer|\bfetch\s*\(/,
      );
    }
    expect(apply).toContain('origin: "history-sync"');
    expect(apply).toContain("historySync: true");
    expect(script).toContain("dry-run");
  });
});
