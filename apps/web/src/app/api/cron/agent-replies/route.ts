import { NextRequest, NextResponse } from "next/server";
import { runAgentReplies } from "@/services/agent/agent-worker";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// The vision step can call the VPS crm-tools (up to ~90s each, capped per tick).
export const maxDuration = 300;

/**
 * Sales agent reply worker. Runs every minute. No-ops unless a workspace has
 * the master switch ON (default OFF). Honors the per-workspace dry-run flag.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runAgentReplies();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/agent-replies]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent-replies failed" },
      { status: 500 }
    );
  }
}
