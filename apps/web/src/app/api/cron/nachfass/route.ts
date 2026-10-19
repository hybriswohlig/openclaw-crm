import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runNachfass } from "@/services/nachfass/motor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nachfass-Bot. Läuft häufig, entscheidet selbst über das Berliner
 * Kundenfenster 9–19. Erzeugt Entwürfe; versendet nichts, solange die
 * Regel-Schalter aus sind (Default) und das Agenten-dryRun an bleibt.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runNachfass();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/nachfass]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "nachfass failed" },
      { status: 500 }
    );
  }
}
