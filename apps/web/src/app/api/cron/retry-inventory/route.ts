import { NextRequest, NextResponse } from "next/server";
import { wiederholeFehlgeschlagenesInventar } from "@/services/inventar-wiederholung-lauf";
import { requireCronAuth } from "@/lib/cron-auth";

// Ein Deal pro Lauf; eine Extraktion dauert bis etwa 2 Minuten.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/retry-inventory
 *
 * Vercel Cron, tagsüber alle 15 Minuten. Wiederholt eine fehlgeschlagene
 * Inventar-Erstbefüllung aus dem Chat (Ereignis ai.inventory_extract_attempt
 * mit Status fehler, oder ein abgebrochener Lauf): höchstens 3 Fehlversuche in
 * 24 Stunden, frühestens 15 Minuten nach dem letzten, nur für Deals, die noch
 * kein Inventar haben (Regeln: services/inventar-wiederholung.ts). Ein Erfolg stößt über
 * applyDealInventory die Neuberechnung der Kalkulation an.
 *
 * Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const ergebnis = await wiederholeFehlgeschlagenesInventar();
    if (ergebnis) console.log(`[cron/retry-inventory] ${JSON.stringify(ergebnis)}`);
    return NextResponse.json({ success: true, ergebnis });
  } catch (err) {
    console.error("[cron/retry-inventory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "retry-inventory failed" },
      { status: 500 }
    );
  }
}
