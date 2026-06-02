/**
 * Phase 4: scan for soft merge suggestions (name similarity, no shared hard key)
 * and (with --apply) write them to person_merge_edges as status='suggested' for
 * operator review in the Phase 5 UI. REPORT by default. Non-destructive: writes
 * only suggestion rows (deletable); never merges.
 *
 * Run: NODE_ENV=production DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/scan-suggestions.ts [--apply]
 */
import { db } from "@/db";
import { objects } from "@/db/schema";
import { scanForSuggestions } from "@/services/identity-suggestions";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Merge-suggestion scan — ${APPLY ? "APPLY (write suggestions)" : "REPORT"} ===`);
  const wss = await db.select({ id: objects.workspaceId }).from(objects).groupBy(objects.workspaceId);
  const workspaceIds = [...new Set(wss.map((w) => w.id))];
  let total = 0;
  for (const workspaceId of workspaceIds) {
    const pairs = await scanForSuggestions(workspaceId, { apply: APPLY });
    total += pairs.length;
    for (const p of pairs.sort((a, b) => b.jw - a.jw)) {
      console.log(`  jw=${p.jw.toFixed(3)}  "${p.nameA}"  <->  "${p.nameB}"  (${p.survivor.slice(0, 8)} / ${p.absorbed.slice(0, 8)})`);
    }
  }
  console.log(`\n${total} suggestion(s) ${APPLY ? "written (status=suggested)" : "found"}.`);
  console.log(APPLY ? "Review them in the person view once Phase 5 ships.\n" : "REPORT only — re-run with --apply to write them.\n");
  process.exit(0);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
