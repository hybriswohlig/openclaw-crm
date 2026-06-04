import { NextRequest, NextResponse } from "next/server";
import { runAgentClassify } from "@/services/agent/agent-classify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Maintains the per-conversation stage/priority/missing flags shown in the
 * inbox. Deterministic and cheap (no LLM), independent of whether the agent is
 * enabled or sending. Runs every few minutes.
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
