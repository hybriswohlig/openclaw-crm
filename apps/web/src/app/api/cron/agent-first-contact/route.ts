import { NextRequest, NextResponse } from "next/server";
import { runAgentFirstContact } from "@/services/agent/agent-first-contact";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Proactive first contact for fresh ImmoScout leads. Runs every 2 minutes so a
 * new lead gets its WhatsApp opener within ~4 minutes of the lead email
 * (speed-to-lead). No-ops unless a workspace has the first-contact switch ON
 * (default OFF) AND a channel account configured. Only ever touches leads
 * created after the switch was enabled; honors dry-run, the 08-20 Berlin send
 * window, and the daily cap.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runAgentFirstContact();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/agent-first-contact]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent-first-contact failed" },
      { status: 500 }
    );
  }
}
