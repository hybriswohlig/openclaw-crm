import { NextRequest, NextResponse } from "next/server";
import { runAgentFollowups } from "@/services/agent/agent-followup";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sales agent follow-up engine. Runs once a day. No-ops unless a workspace has
 * the follow-up switch ON (default OFF). Honors the per-workspace dry-run flag,
 * and never follows up a lead whose move date has already passed.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runAgentFollowups();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/agent-followups]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent-followups failed" },
      { status: 500 }
    );
  }
}
