/**
 * Track 2 verification harness: compare FULL vs INCREMENTAL KI extraction for
 * one deal.
 *
 * For an over-budget deal it runs extractDealInsights twice — once forcing the
 * legacy full/trim path, once with incremental enabled — and diffs the
 * resulting structured fields, so you can confirm incremental keeps the same
 * quality before widening it. For an under-budget deal incremental never
 * engages, so both runs are identical and there is nothing to compare.
 *
 * Each run calls `claude -p` on the VPS, so this uses 2 jobs of Max-plan quota
 * per deal. It never applies anything (no applyDealInsights, no AI-derived
 * writes). The only DB write is getDealTranscript's idempotent deal/conversation
 * back-link, which is benign metadata.
 *
 * Note: LLM output varies run-to-run on free-text fields (summary, wording), so
 * expect those to differ even between two FULL runs. What matters is that the
 * SLOT fields (addresses, floors, dates, value, elevator, volume, etc.) match.
 *
 * Env (DATABASE_URL, CRM_TOOLS_API_URL, CRM_TOOLS_AUTH_TOKEN) is loaded
 * automatically from the repo-root and apps/web .env / .env.local files.
 *
 *   pnpm --filter @openclaw-crm/web exec tsx scripts/compare-insights.ts [dealRecordId] [workspaceId] [--engage=<chars>]
 *
 * If no dealRecordId is given, the deal with the largest transcript is picked
 * automatically (best candidate to exercise the delta path).
 *
 * --engage lowers the char threshold at which incremental engages, so you can
 * test it on a normal-sized deal before widening the shipped 60k default.
 * Example: --engage=8000 makes incremental engage for any deal over ~8k chars.
 */
// MUST be first: loads env (and defaults NODE_ENV) before any "@/" module is
// evaluated, so run-task.ts's import-time CRM_TOOLS_* consts see the values.
import "./_load-env";

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { objects } from "@/db/schema";
import { extractDealInsights, type DealInsights } from "@/services/deal-insights";
import { getDealTranscript, transcriptExceedsBudget } from "@/services/deal-transcript";

const rawArgs = process.argv.slice(2);
const engageArg = rawArgs.find((a) => a.startsWith("--engage="));
const engageChars = engageArg ? parseInt(engageArg.split("=")[1], 10) : undefined;
const positional = rawArgs.filter((a) => !a.startsWith("--"));
let dealRecordId = positional[0];
let workspaceId = positional[1];

function flatten(insights: DealInsights | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!insights) return out;
  for (const [k, v] of Object.entries(insights.extracted)) out[`extracted.${k}`] = norm(v);
  out["suggested_stage"] = norm(insights.suggested_stage);
  out["scope_change_vs_quote.changed"] = norm(insights.scope_change_vs_quote?.changed ?? false);
  out["missingFields"] = (insights.missingFields ?? []).join(" | ");
  out["criticalMissing"] = (insights.criticalMissing ?? []).map((c) => c.field).sort().join(" | ");
  out["openCustomerQuestions#"] = String((insights.openCustomerQuestions ?? []).length);
  out["legalFlags#"] = String((insights.legalFlags ?? []).length);
  out["summary~len"] = String((insights.summary ?? "").length);
  return out;
}

function norm(v: unknown): string {
  if (v == null) return "∅";
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Slot fields whose value should NOT change between full and incremental.
// Differences here are real regressions; differences elsewhere (summary length,
// question count) are expected LLM variance.
const SLOT_FIELDS = new Set([
  "extracted.customer_name",
  "extracted.customer_phone",
  "extracted.customer_email",
  "extracted.move_date",
  "extracted.move_from_address",
  "extracted.move_to_address",
  "extracted.floors_from",
  "extracted.floors_to",
  "extracted.elevator_from",
  "extracted.elevator_to",
  "extracted.estimated_value_eur",
  "extracted.volume_cbm",
  "extracted.payment_method",
  "extracted.transporter",
  "suggested_stage",
  "scope_change_vs_quote.changed",
]);

async function main() {
  if (!workspaceId) {
    const rows = await db.select({ id: objects.workspaceId }).from(objects).groupBy(objects.workspaceId);
    const ids = [...new Set(rows.map((r) => r.id))];
    if (ids.length !== 1) {
      console.error(`Pass workspaceId explicitly (found ${ids.length} workspaces).`);
      process.exit(1);
    }
    workspaceId = ids[0];
  }

  if (!dealRecordId) {
    // Auto-pick the deal with the largest linked transcript, so you do not have
    // to hunt for an ID. Runs under your own authorized env when you run this.
    const rows = await db.execute<{ id: string; chars: string }>(sql`
      SELECT c.deal_record_id AS id, SUM(LENGTH(COALESCE(m.body, ''))) AS chars
      FROM inbox_conversations c
      JOIN inbox_messages m ON m.conversation_id = c.id
      WHERE c.deal_record_id IS NOT NULL AND c.workspace_id = ${workspaceId}
      GROUP BY c.deal_record_id
      ORDER BY chars DESC
      LIMIT 1
    `);
    const top = (rows as unknown as Array<{ id: string; chars: string }>)[0];
    if (!top?.id) {
      console.error("No deals with linked messages found. Pass a <dealRecordId> explicitly.");
      process.exit(1);
    }
    dealRecordId = top.id;
    console.log(`Auto-picked deal ${dealRecordId} (largest transcript, ~${top.chars} message chars).`);
  }

  const transcript = await getDealTranscript(workspaceId, dealRecordId);
  const exceeds = transcriptExceedsBudget(transcript, engageChars);
  console.log(`\nDeal ${dealRecordId}`);
  console.log(
    `Messages: ${transcript.messageCount} | engage threshold: ${engageChars ?? "default (60k)"} chars | incremental engages: ${exceeds}`,
  );
  if (!exceeds) {
    console.log(
      "\nUnder the engage threshold → incremental never engages → both runs are identical. Pass --engage=<chars> (e.g. --engage=8000) to test incremental on a smaller deal.",
    );
    process.exit(0);
  }

  console.log("\nRunning FULL extraction (forceFullTranscript)…");
  const full = await extractDealInsights(workspaceId, dealRecordId, { forceFullTranscript: true });
  if (full.error) console.log(`  FULL error: ${full.error}`);
  console.log("Running INCREMENTAL extraction…");
  const incr = await extractDealInsights(workspaceId, dealRecordId, { engageChars });
  if (incr.error) console.log(`  INCR error: ${incr.error}`);

  if (!full.insights || !incr.insights) {
    console.log(
      "\n✗ Cannot compare: one or both extractions returned no insights (see the errors above). Nothing was validated.",
    );
    process.exit(1);
  }

  const a = flatten(full.insights);
  const b = flatten(incr.insights);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  let slotDiffs = 0;
  let otherDiffs = 0;
  console.log("\nfield                              | full  →  incremental");
  console.log("-".repeat(78));
  for (const k of keys) {
    const av = a[k] ?? "∅";
    const bv = b[k] ?? "∅";
    if (av === bv) continue;
    const isSlot = SLOT_FIELDS.has(k);
    if (isSlot) slotDiffs++;
    else otherDiffs++;
    console.log(`${isSlot ? "⚠ " : "  "}${k.padEnd(32)} | ${av}  →  ${bv}`);
  }
  console.log("-".repeat(78));
  console.log(`Slot-field differences (concerning): ${slotDiffs}`);
  console.log(`Other differences (expected LLM variance): ${otherDiffs}`);
  console.log(
    slotDiffs === 0
      ? "\n✓ Incremental matched full on all slot fields. Quality preserved for this deal."
      : "\n✗ Incremental diverged on slot field(s). Inspect the ⚠ rows before widening incremental.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
