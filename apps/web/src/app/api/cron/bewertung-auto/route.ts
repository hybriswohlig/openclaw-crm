import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { bewertungAutomatikLauf } from "@/services/bewertung-automatik";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bewertungs-Automatik (Plan 11). Alle 15 Minuten: Klick-Daten nach 90 Tagen
 * löschen, fällige Bewertungsanfragen je Firma vormerken (Modus entwurf oder
 * senden) und vorgemerkte im erlaubten Zeitfenster über die Handstrecke senden.
 * Mit allen Firmen auf „aus“ räumt der Lauf nur auf und sendet Vormerkungen,
 * die ein Mensch außerhalb der Sendezeit angelegt hat.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await bewertungAutomatikLauf(new Date());
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/bewertung-auto]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bewertung-auto failed" },
      { status: 500 }
    );
  }
}
