import { NextRequest, NextResponse } from "next/server";
import { kiWaechterLauf } from "@/services/intern/ki-waechter-lauf";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ki-waechter
 *
 * Vercel Cron alle 15 Minuten. Prüft die Erfolgsquote der KI-Jobs
 * (ai_task_runs) und meldet Ausfälle per WhatsApp an die internen Nummern
 * (Alarm, Erinnerung alle 6 Stunden, Entwarnung; nachts wird nichts gesendet).
 * Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  try {
    const ergebnisse = await kiWaechterLauf();
    if (ergebnisse.some((e) => e.aktion)) console.log(`[cron/ki-waechter] ${JSON.stringify(ergebnisse)}`);
    return NextResponse.json({ success: true, ergebnisse });
  } catch (err) {
    console.error("[cron/ki-waechter]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "ki-waechter failed" }, { status: 500 });
  }
}
