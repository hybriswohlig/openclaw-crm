import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runZahlungserinnerung } from "@/services/zahlungserinnerung/lauf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Zahlungserinnerung. Läuft morgens, entscheidet selbst über das Berliner
 * Kundenfenster 9–19. Erzeugt nur Entwürfe, versendet nichts.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runZahlungserinnerung();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/zahlungserinnerung]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "zahlungserinnerung failed" },
      { status: 500 }
    );
  }
}
