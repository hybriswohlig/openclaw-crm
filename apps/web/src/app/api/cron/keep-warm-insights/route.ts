import { NextRequest, NextResponse } from "next/server";
import { refreshInContactLeadsGlobal } from "@/services/deal-insights-auto-refresh";

// Capped at 2 deals per tick; p90 extraction is ~2 min, so two always fit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/keep-warm-insights
 *
 * Hit by Vercel Cron every 10 minutes during the day. Keeps the KI-Summary
 * cache (`ai.insights_extracted` events read via GET /latest-insights) warm:
 * when a conversation received new inbound messages and has been quiet for
 * at least 10 minutes, the extraction runs in the background so the result
 * is ALREADY THERE when someone opens the deal or the inbox panel. Nobody
 * waits on a spinner for an answer that could have been precomputed.
 *
 * Differences from the nightly /refresh-leads-insights run:
 *   - max 2 deals per tick (fits the function budget, spreads VPS load)
 *   - 10 min quiet-window debounce (never extract mid-conversation)
 *   - silent cache event (no visible activity-feed note per refresh)
 *   - VPS background lane (never competes with a user-triggered job)
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
    const summaries = await refreshInContactLeadsGlobal({
      maxDeals: 2,
      quietMinutes: 10,
      silentNote: true,
      background: true,
    });
    const elapsedMs = Date.now() - started;
    const totals = summaries.reduce(
      (acc, s) => {
        acc.totalCandidates += s.summary.totalCandidates;
        acc.refreshed += s.summary.refreshed;
        acc.skippedNoNewMessages += s.summary.skippedNoNewMessages;
        acc.failed += s.summary.failed;
        return acc;
      },
      { totalCandidates: 0, refreshed: 0, skippedNoNewMessages: 0, failed: 0 }
    );
    if (totals.refreshed > 0 || totals.failed > 0) {
      console.log(
        `[cron/keep-warm-insights] done in ${elapsedMs}ms — ${JSON.stringify(totals)}`
      );
    }
    return NextResponse.json({ success: true, elapsedMs, totals });
  } catch (err) {
    console.error("[cron/keep-warm-insights]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "keep-warm failed" },
      { status: 500 }
    );
  }
}
