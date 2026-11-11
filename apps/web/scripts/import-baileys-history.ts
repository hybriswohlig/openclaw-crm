#!/usr/bin/env tsx
/**
 * Import a Baileys history spool into the CRM inbox.
 *
 * The bridge writes caught-up messages to
 * `/tmp/baileys-history-catchup.jsonl` on the bridge host when the CRM has
 * not opted in (or before this deploy). WhatsApp only sends that history
 * while a device is linking. This script reads a copy of that file. It does
 * not open a socket, does not call the bridge, and does not send WhatsApp
 * or email.
 *
 * Dry-run is the default. Nothing is written unless `--apply` is present.
 *
 *   pnpm --filter @openclaw-crm/web whatsapp:import-history -- \
 *     --account 82027c02-f0da-49db-923a-12a1d0f9a552 \
 *     --since 2026-11-04T19:37:00.000Z \
 *     --file ./baileys-history-catchup.jsonl
 *
 *   # same command plus --apply, with DATABASE_URL pointing at the target
 *   # database. Do not point it at a database you have not reviewed.
 *
 * `--since` is required. For the default 7-day window, pass the instant
 * seven days before the pairing. Rows for any other channel account are
 * ignored. The two Ceylan accounts are refused before the file is applied.
 *
 * Copy the spool off the bridge host without restarting the container
 * (a restart drops /tmp and disconnects the live socket):
 *
 *   docker cp "$(docker ps -qf name=baileys-bridge)":/tmp/baileys-history-catchup.jsonl ./baileys-history-catchup.jsonl
 */
import { readFileSync } from "node:fs";
import {
  historyWindowStartMs,
  isHistorySyncExcludedAccount,
  planHistoryImport,
  type HistorySpoolPayload,
} from "../src/services/baileys-history-sync";

interface CliArgs {
  accountId: string;
  sinceMs: number;
  file: string;
  apply: boolean;
}

function usage(): string {
  return [
    "usage: import-baileys-history --account <uuid> --since <iso> --file <jsonl> [--apply]",
    "default: dry-run (no database, no WhatsApp, no email)",
  ].join("\n");
}

export function parseHistoryImportArgs(argv: string[]): CliArgs {
  let accountId = "";
  let since = "";
  let file = "";
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--account" && next) {
      accountId = next;
      i += 1;
      continue;
    }
    if (arg === "--since" && next) {
      since = next;
      i += 1;
      continue;
    }
    if (arg === "--file" && next) {
      file = next;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument ${arg}\n${usage()}`);
  }
  if (!accountId || !since || !file) throw new Error(usage());
  if (isHistorySyncExcludedAccount(accountId)) {
    throw new Error("refusing history import for an excluded channel account");
  }
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) throw new Error(`--since must be an ISO timestamp\n${usage()}`);
  return { accountId, sinceMs, file, apply };
}

function readSpool(file: string): Array<{ kind?: unknown; payload?: HistorySpoolPayload }> {
  const text = readFileSync(file, "utf8");
  const lines: Array<{ kind?: unknown; payload?: HistorySpoolPayload }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(JSON.parse(trimmed) as { kind?: unknown; payload?: HistorySpoolPayload });
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseHistoryImportArgs(process.argv.slice(2));
  const plan = planHistoryImport(readSpool(args.file), {
    accountId: args.accountId,
    sinceMs: args.sinceMs,
  });
  const summary = {
    dryRun: !args.apply,
    accountId: args.accountId,
    since: new Date(args.sinceMs).toISOString(),
    defaultWindowStart: new Date(historyWindowStartMs()).toISOString(),
    importCount: plan.importRows.length,
    skipped: plan.skipped,
    rows: plan.importRows.map((row) => ({
      kind: row.kind,
      externalMessageId: row.externalMessageId,
      sentAt: row.sentAt,
      peerWaId: row.peerWaId,
      preview: row.body.replace(/\s+/g, " ").slice(0, 80),
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!args.apply) {
    console.log("dry-run only. Pass --apply to write these rows. No WhatsApp and no email were sent.");
    return;
  }
  const { applyBaileysHistoryImport } = await import("../src/services/baileys-history-apply");
  const written = await applyBaileysHistoryImport({
    accountId: args.accountId,
    since: new Date(args.sinceMs),
    rows: plan.importRows,
  });
  console.log(JSON.stringify({ applied: true, ...written }));
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("import-baileys-history.ts") || entry.endsWith("import-baileys-history.js")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
