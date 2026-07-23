import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { OVERALL_BUDGET_MS, transcribePendingAudio } from "@/services/inbox-transcribe";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Voice-note transcription worker (Phase 0 of the agent rebuild). Transcribes
 * inbound WhatsApp audio attachments via the crm-tools /skills/transcribe-audio
 * endpoint so the sales agent reads voice answers like text. Runs every 5
 * minutes; no-ops when there is no pending audio. Safe while the VPS-side
 * skill is not deployed yet (404 → attachment marked attempted, no retries).
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const wsRows = await db.select({ id: workspaces.id }).from(workspaces);
    const totals = { workspaces: wsRows.length, attempted: 0, succeeded: 0, failed: 0 };
    const perWorkspace: Record<
      string,
      { attempted: number; succeeded: number; failed: number }
    > = {};
    // ONE deadline for the whole invocation (maxDuration = 120): shared across
    // all workspaces so sequential ticks can never stack past the budget.
    const deadline = Date.now() + OVERALL_BUDGET_MS;
    for (const w of wsRows) {
      if (Date.now() >= deadline) break;
      const summary = await transcribePendingAudio(w.id, { deadline });
      totals.attempted += summary.attempted;
      totals.succeeded += summary.succeeded;
      totals.failed += summary.failed;
      if (summary.attempted > 0) {
        perWorkspace[w.id] = summary;
      }
    }
    if (totals.attempted > 0) {
      console.log(`[cron/transcribe-audio] ${JSON.stringify({ ...totals, perWorkspace })}`);
    }
    return NextResponse.json({ success: true, ...totals, perWorkspace });
  } catch (err) {
    console.error("[cron/transcribe-audio]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transcribe-audio failed" },
      { status: 500 }
    );
  }
}
