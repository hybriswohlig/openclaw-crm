import { NextRequest, NextResponse } from "next/server";
import { berlinHour } from "@/lib/berlin-date";
import { requireCronAuth } from "@/lib/cron-auth";
import { neueJobsRundschreiben } from "@/services/crew/nachrichten";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Berliner Stunde, zu der die Sammelnachricht rausgeht. */
const STUNDE = 18;

/**
 * Crew-Portal: einmal am Abend WhatsApp zu neuen Jobs (Rümpeltürken-Konto).
 * Läuft um 16 und 17 Uhr UTC; gesendet wird nur, wenn es in Berlin 18 Uhr ist
 * (Sommer- und Winterzeit). Pro Person höchstens eine Nachricht am Tag.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (berlinHour() !== STUNDE) return NextResponse.json({ success: true, uebersprungen: "nicht 18 Uhr in Berlin" });
  try {
    const summary = await neueJobsRundschreiben();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/crew-neue-jobs]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "crew-neue-jobs failed" }, { status: 500 });
  }
}
