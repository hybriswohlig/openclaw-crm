import { NextRequest, NextResponse } from "next/server";
import { fotosAbarbeiten } from "@/services/inventar-fotos";
import { requireCronAuth } from "@/lib/cron-auth";

// Ein Foto-Stapel je Lauf; die Analyse dauert bis etwa 270 Sekunden.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/fotos-analysieren
 *
 * Vercel Cron, tagsüber alle 10 Minuten (länger als ein Lauf, damit sich Läufe
 * nicht überlappen). Analysiert Kundenfotos, die der Agent vorgemerkt hat, und
 * ordnet sie der Inventarliste zu; danach rechnet die Kalkulation neu.
 * Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  try {
    const ergebnis = await fotosAbarbeiten();
    if (ergebnis) console.log(`[cron/fotos-analysieren] ${JSON.stringify(ergebnis)}`);
    return NextResponse.json({ success: true, ergebnis });
  } catch (err) {
    console.error("[cron/fotos-analysieren]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "fotos-analysieren failed" }, { status: 500 });
  }
}
