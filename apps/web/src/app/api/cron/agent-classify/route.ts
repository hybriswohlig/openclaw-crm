import { NextRequest, NextResponse } from "next/server";
import { runAgentClassify } from "@/services/agent/agent-classify";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Maintains the per-conversation stage/priority/missing flags shown in the
 * inbox. Deterministic and cheap (no LLM), independent of whether the agent is
 * enabled or sending. Runs every few minutes.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runAgentClassify();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/agent-classify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent-classify failed" },
      { status: 500 }
    );
  }
}
