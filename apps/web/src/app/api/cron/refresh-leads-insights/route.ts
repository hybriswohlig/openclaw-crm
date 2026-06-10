import { NextRequest, NextResponse } from "next/server";
import { refreshInContactLeadsGlobal } from "@/services/deal-insights-auto-refresh";

// 5 minutes — covers ~80 deals at 2s throttle plus extraction latency.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/refresh-leads-insights
 *
 * Hit by Vercel Cron daily at 07:00 UTC (≈ 09:00 CEST / 08:00 CET).
 * Iterates every workspace and re-runs deal-insights extraction for
 * "In Kontakt" leads that have new inbox messages since the last log
 * entry. Field updates honour the protected-fields whitelist (workers
 * and transporter never auto-touched). Stage moves are forward-only.
 *
 * Bearer-token auth via CRON_SECRET — Vercel injects this header
 * automatically when CRON_SECRET is set as an env var.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const started = Date.now();
    // Background lane: the nightly batch must never contend with a
    // user-triggered document job on the VPS's single vCPU.
    const summaries = await refreshInContactLeadsGlobal({ background: true });
    const elapsedMs = Date.now() - started;
    const totals = summaries.reduce(
      (acc, s) => {
        acc.totalCandidates += s.summary.totalCandidates;
        acc.refreshed += s.summary.refreshed;
        acc.skippedNoNewMessages += s.summary.skippedNoNewMessages;
        acc.failed += s.summary.failed;
        return acc;
      },
      {
        totalCandidates: 0,
        refreshed: 0,
        skippedNoNewMessages: 0,
        failed: 0,
      }
    );
    console.log(
      `[cron/refresh-leads-insights] done in ${elapsedMs}ms — ${JSON.stringify(totals)}`
    );
    return NextResponse.json({
      success: true,
      elapsedMs,
      totals,
      perWorkspace: summaries,
    });
  } catch (err) {
    console.error("[cron/refresh-leads-insights]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "refresh failed" },
      { status: 500 }
    );
  }
}
