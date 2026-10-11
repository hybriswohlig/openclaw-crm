import { NextRequest, NextResponse } from "next/server";
import { fotosAbarbeiten } from "@/services/inventar-fotos";
import { requireCronAuth } from "@/lib/cron-auth";

// Bis zu vier Einzelfotos je Lauf, gleichzeitig; ein Job dauert höchstens etwa 270 Sekunden.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/fotos-analysieren
 *
 * Vercel Cron, tagsüber alle 5 Minuten. Ein Lauf dauert höchstens 300 s;
 * überlappt er doch, überspringt der nächste Fotos mit laufendem Versuch.
 * Analysiert Kundenfotos, die der Agent vorgemerkt hat, und ordnet sie der
 * Inventarliste zu; danach rechnet die Kalkulation neu.
 * Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  try {
    const ergebnis = await fotosAbarbeiten();
    if (ergebnis.length > 0) console.log(`[cron/fotos-analysieren] ${JSON.stringify(ergebnis)}`);
    return NextResponse.json({ success: true, ergebnis });
  } catch (err) {
    console.error("[cron/fotos-analysieren]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "fotos-analysieren failed" }, { status: 500 });
  }
}
