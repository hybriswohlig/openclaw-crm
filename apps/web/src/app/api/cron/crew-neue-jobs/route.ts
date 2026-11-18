import { NextRequest, NextResponse } from "next/server";
import { berlinHour } from "@/lib/berlin-date";
import { requireCronAuth } from "@/lib/cron-auth";
import { neueJobsRundschreiben } from "@/services/crew/nachrichten";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Berliner Stunde, zu der die Sammelnachricht rausgeht. */
const STUNDE = 18;
/** Danach nicht mehr nachholen (abends keine Nachrichten mehr). */
const BIS = 21;

/**
 * Crew-Portal: einmal am Abend WhatsApp zu neuen Jobs (Rümpeltürken-Konto).
 * Läuft um 16 und 17 Uhr UTC; gesendet wird ab 18 Uhr Berliner Zeit (Sommer-
 * und Winterzeit), ein verspäteter Aufruf holt es bis 21 Uhr nach. Der Tageslauf
 * ist je Workspace atomar beansprucht, pro Person höchstens eine Nachricht am Tag.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const h = berlinHour();
  if (h < STUNDE || h >= BIS) return NextResponse.json({ success: true, uebersprungen: "nicht zwischen 18 und 21 Uhr in Berlin" });
  try {
    const summary = await neueJobsRundschreiben();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/crew-neue-jobs]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "crew-neue-jobs failed" }, { status: 500 });
  }
}
