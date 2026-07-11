import { NextRequest, NextResponse } from "next/server";
import { syncImmoscoutLeadsGlobal } from "@/services/immoscout-sync";
import { requireCronAuth } from "@/lib/cron-auth";

// Pulls ImmobilienScout24 (umzug-easy.de) relocation leads for every workspace
// with an active integration. The IS24 *email* channel is handled separately by
// the inbox-sync cron; this covers the umzug-easy REST export. Both dedup on the
// shared IS24 request id, so running both never doubles a lead.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/immoscout-sync
 *
 * Hit by Vercel Cron every 15 minutes. Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const started = Date.now();
    const results = await syncImmoscoutLeadsGlobal();
    const elapsedMs = Date.now() - started;
    const totals = results.reduce(
      (acc, r) => {
        if (r.result) {
          acc.total += r.result.total;
          acc.created += r.result.created;
          acc.skipped += r.result.skipped;
          acc.errors += r.result.errors.length;
        }
        if (r.error) acc.failedWorkspaces += 1;
        return acc;
      },
      { total: 0, created: 0, skipped: 0, errors: 0, failedWorkspaces: 0 }
    );
    console.log(`[cron/immoscout-sync] done in ${elapsedMs}ms — ${JSON.stringify(totals)}`);
    return NextResponse.json({ success: true, elapsedMs, totals, perWorkspace: results });
  } catch (err) {
    console.error("[cron/immoscout-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 }
    );
  }
}
