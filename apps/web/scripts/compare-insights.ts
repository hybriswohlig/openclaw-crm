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
 *   DATABASE_URL=... CRM_TOOLS_API_URL=... CRM_TOOLS_AUTH_TOKEN=... \
 *     pnpm --filter @openclaw-crm/web exec tsx scripts/compare-insights.ts <dealRecordId> [workspaceId]
 */
import { db } from "@/db";
import { objects } from "@/db/schema";
import { extractDealInsights, type DealInsights } from "@/services/deal-insights";
import { getDealTranscript, transcriptExceedsBudget } from "@/services/deal-transcript";

const dealRecordId = process.argv[2];
let workspaceId = process.argv[3];

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
  if (!dealRecordId) {
    console.error("usage: tsx scripts/compare-insights.ts <dealRecordId> [workspaceId]");
    process.exit(1);
  }
  if (!workspaceId) {
    const rows = await db.select({ id: objects.workspaceId }).from(objects).groupBy(objects.workspaceId);
    const ids = [...new Set(rows.map((r) => r.id))];
    if (ids.length !== 1) {
      console.error(`Pass workspaceId explicitly (found ${ids.length} workspaces).`);
      process.exit(1);
    }
    workspaceId = ids[0];
  }

  const transcript = await getDealTranscript(workspaceId, dealRecordId);
  const exceeds = transcriptExceedsBudget(transcript);
  console.log(`\nDeal ${dealRecordId}`);
  console.log(`Messages: ${transcript.messageCount} | over budget (incremental engages): ${exceeds}`);
  if (!exceeds) {
    console.log("\nUnder budget → incremental never engages → both runs are identical. Nothing to compare.");
    process.exit(0);
  }

  console.log("\nRunning FULL extraction (forceFullTranscript)…");
  const full = await extractDealInsights(workspaceId, dealRecordId, { forceFullTranscript: true });
  if (full.error) console.log(`  FULL error: ${full.error}`);
  console.log("Running INCREMENTAL extraction…");
  const incr = await extractDealInsights(workspaceId, dealRecordId);
  if (incr.error) console.log(`  INCR error: ${incr.error}`);

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
