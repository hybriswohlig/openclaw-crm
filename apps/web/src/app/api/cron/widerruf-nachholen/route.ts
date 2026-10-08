import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { widerrufeNachholen } from "@/services/kva-widerruf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Holt Team-Alarm und Eingangsbestätigung (§ 356a Abs. 4 BGB) für Widerrufe
 * nach, deren Nachlauf nach der Antwort abgebrochen oder gescheitert ist.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const nachgeholt = await widerrufeNachholen();
  return NextResponse.json({ ok: true, nachgeholt });
}
